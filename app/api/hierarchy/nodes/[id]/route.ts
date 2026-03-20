import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { deleteHierarchyNode, fetchHierarchyNodeDetails, updateHierarchyNode } from "@/services/hierarchy/hierarchy.service";
import { hierarchyNodeIdSchema, updateHierarchyNodeSchema } from "@/services/hierarchy/hierarchy.schemas";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getRequestActor(request);
    if (!actor.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const nodeId = hierarchyNodeIdSchema.parse(params.id);
    const details = await fetchHierarchyNodeDetails(nodeId);
    return NextResponse.json(details);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid node id", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const nodeId = hierarchyNodeIdSchema.parse(params.id);
    const before = await fetchHierarchyNodeDetails(nodeId);
    const payload = updateHierarchyNodeSchema.parse(await request.json());
    const node = await updateHierarchyNode(nodeId, {
      nodeKind: payload.nodeKind,
      nodeKey: payload.nodeKey,
      name: payload.name,
      sortOrder: payload.sortOrder,
      allowRecordAssignment: payload.allowRecordAssignment,
      mutationMode: payload.mutationMode,
      canHaveChildren: payload.canHaveChildren,
      canContainRecords: payload.canContainRecords,
      isActive: payload.isActive,
      metadata: payload.metadata
    });

    await writeAuditLog({
      user_id: actor.userId,
      action: "hierarchy_node_update",
      record_type: "hierarchy_nodes",
      record_id: node.id,
      before_json: before.node as unknown as Record<string, unknown>,
      after_json: node as unknown as Record<string, unknown>,
      source: "hierarchy"
    });

    return NextResponse.json({ ok: true, node });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.toLowerCase().includes("root") || message.toLowerCase().includes("navigation-only") || message.toLowerCase().includes("archive") || message.toLowerCase().includes("cannot") || message.toLowerCase().includes("media hierarchy")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const nodeId = hierarchyNodeIdSchema.parse(params.id);
    const before = await fetchHierarchyNodeDetails(nodeId);
    const result = await deleteHierarchyNode(nodeId);

    await writeAuditLog({
      user_id: actor.userId,
      action: "hierarchy_node_delete",
      record_type: "hierarchy_nodes",
      record_id: nodeId,
      before_json: {
        node: before.node,
        usage: result.counts
      },
      after_json: {},
      source: "hierarchy"
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid node id", issues: error.issues }, { status: 400 });
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("cannot be deleted")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
