import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseClient } from "@/services/supabase/client";
import { getRequestActor } from "@/services/auth/role.service";
import { fetchHierarchyTree, fetchMediaByNode, fetchMediaCountsByFamily } from "@/services/hierarchy/hierarchy.service";

const querySchema = z.object({
  family: z.enum(["sale", "rent", "buyers", "clients"]),
  nodeId: z.string().uuid().optional(),
  mediaType: z.enum(["all", "image", "video", "document", "other"]).optional().default("all")
});

const recordTypeByFamily = {
  sale: "properties_sale",
  rent: "properties_rent",
  buyers: "buyers",
  clients: "clients"
} as const;

async function fetchUnassignedMediaForFamily(family: keyof typeof recordTypeByFamily) {
  const supabase = createSupabaseClient();
  const recordType = recordTypeByFamily[family];

  const { data: linkedMediaRows, error: linkedError } = await supabase
    .from("media_hierarchy_links")
    .select("media_id");

  if (linkedError) throw new Error(linkedError.message);

  const linkedIds = new Set((linkedMediaRows || []).map((row) => String(row.media_id || "")).filter(Boolean));

  const { data: mediaRows, error: mediaError } = await supabase
    .from("media")
    .select("*")
    .or(`record_type.eq.${recordType},and(record_type.is.null,intake_session_id.not.is.null)`)
    .order("created_at", { ascending: false })
    .limit(300);

  if (mediaError) throw new Error(mediaError.message);

  const intakeIds = (mediaRows || [])
    .filter((row) => !row.record_type && row.intake_session_id)
    .map((row) => String(row.intake_session_id || ""))
    .filter(Boolean);

  const intakeFamilyIds = new Set<string>();
  if (intakeIds.length > 0) {
    const { data: sessions, error: sessionError } = await supabase
      .from("intake_sessions")
      .select("id,type_detected,type_confirmed")
      .in("id", intakeIds);

    if (sessionError) throw new Error(sessionError.message);

    for (const session of sessions || []) {
      const type = String(session.type_confirmed || session.type_detected || "").trim();
      if ((family === "buyers" && type === "buyer") || (family === "clients" && type === "client") || type === family) {
        intakeFamilyIds.add(String(session.id));
      }
    }
  }

  return (mediaRows || []).filter((row) => {
    const mediaId = String(row.id || "");
    if (linkedIds.has(mediaId)) return false;
    if (String(row.record_type || "") === recordType) return true;
    if (!row.record_type && row.intake_session_id) return intakeFamilyIds.has(String(row.intake_session_id));
    return false;
  });
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!actor.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      family: searchParams.get("family"),
      nodeId: searchParams.get("nodeId") || undefined,
      mediaType: searchParams.get("mediaType") || "all"
    });

    const treeResult = await fetchHierarchyTree(query.family);
    const counts = await fetchMediaCountsByFamily(query.family);
    const validNodeIds = new Set(treeResult.nodes.map((node) => node.id));

    if (query.nodeId && !validNodeIds.has(query.nodeId)) {
      return NextResponse.json({ error: "Hierarchy node not found for this family" }, { status: 400 });
    }

    const rootNodeId = treeResult.tree[0]?.id;
    const scopedMedia = query.nodeId
      ? ((await fetchMediaByNode({ nodeId: query.nodeId, includeDescendants: true, limit: 300 })) as Array<Record<string, unknown>>)
      : rootNodeId
        ? ((await fetchMediaByNode({ nodeId: rootNodeId, includeDescendants: true, limit: 300 })) as Array<Record<string, unknown>> )
        : [];

    const unassignedMedia = query.nodeId ? [] : await fetchUnassignedMediaForFamily(query.family);
    const media = [...scopedMedia, ...unassignedMedia];

    const filteredMedia = query.mediaType === "all"
      ? media
      : media.filter((item) => String(item.media_type || "other") === query.mediaType);

    return NextResponse.json({
      family: query.family,
      selectedNodeId: query.nodeId || null,
      rootNodeId: rootNodeId || null,
      tree: treeResult.tree,
      nodes: treeResult.nodes,
      counts,
      unassignedCount: unassignedMedia.length,
      media: filteredMedia
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid media browser query", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
