import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { fetchEffectiveFieldDefinitions, saveFieldDefinition } from "@/services/hierarchy/hierarchy.service";
import { fieldsQuerySchema, saveFieldDefinitionSchema } from "@/services/hierarchy/hierarchy.schemas";

export async function GET(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!actor.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const query = fieldsQuerySchema.parse({
      family: searchParams.get("family"),
      nodeId: searchParams.get("nodeId") || undefined
    });

    const fields = await fetchEffectiveFieldDefinitions(query);
    return NextResponse.json({ fields });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid query", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const payload = saveFieldDefinitionSchema.parse(await request.json());
    const result = await saveFieldDefinition({
      id: payload.id,
      family: payload.family,
      fieldKey: payload.fieldKey,
      defaultLabel: payload.defaultLabel,
      description: payload.description,
      dataType: payload.dataType,
      storageKind: payload.storageKind,
      coreColumnName: payload.coreColumnName,
      isSystem: payload.isSystem,
      isActive: payload.isActive,
      isVisibleDefault: payload.isVisibleDefault,
      isRequiredDefault: payload.isRequiredDefault,
      isFilterableDefault: payload.isFilterableDefault,
      isSortableDefault: payload.isSortableDefault,
      isGridVisibleDefault: payload.isGridVisibleDefault,
      isIntakeVisibleDefault: payload.isIntakeVisibleDefault,
      isDetailVisibleDefault: payload.isDetailVisibleDefault,
      displayOrderDefault: payload.displayOrderDefault,
      optionsJson: payload.optionsJson,
      validationJson: payload.validationJson,
      override: payload.override
        ? {
            nodeId: payload.override.nodeId,
            overrideLabel: payload.override.overrideLabel,
            isVisible: payload.override.isVisible,
            isRequired: payload.override.isRequired,
            isFilterable: payload.override.isFilterable,
            isSortable: payload.override.isSortable,
            isGridVisible: payload.override.isGridVisible,
            isIntakeVisible: payload.override.isIntakeVisible,
            isDetailVisible: payload.override.isDetailVisible,
            displayOrder: payload.override.displayOrder,
            widthPx: payload.override.widthPx,
            optionsOverrideJson: payload.override.optionsOverrideJson,
            validationOverrideJson: payload.override.validationOverrideJson
          }
        : undefined,
      actorUserId: actor.userId
    });

    await writeAuditLog({
      user_id: actor.userId,
      action: payload.id ? "field_definition_update" : "field_definition_create",
      record_type: "field_definitions",
      record_id: result.field.id,
      before_json: {},
      after_json: {
        field_key: result.field.field_key,
        family: result.field.family,
        override_node_id: result.override?.node_id || null
      },
      source: "hierarchy"
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
