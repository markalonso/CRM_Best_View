import { z } from "zod";

export const hierarchyFamilySchema = z.enum(["sale", "rent", "buyers", "clients", "media"]);
export const recordFamilySchema = z.enum(["sale", "rent", "buyers", "clients"]);
export const reviewHierarchyTypeSchema = z.enum(["sale", "rent", "buyer", "client"]);
export const hierarchyNodeKindSchema = z.enum(["root", "folder", "project", "building", "unit", "phase", "custom"]);
export const fieldStorageKindSchema = z.enum(["core_column", "custom_value"]);
export const fieldDataTypeSchema = z.enum(["text", "long_text", "integer", "number", "boolean", "date", "timestamp", "single_select", "multi_select", "json"]);

const jsonRecordSchema = z.record(z.string(), z.unknown());
const nodeKeySchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9-_]*$/i, "nodeKey must contain letters, numbers, dashes, or underscores");

export const hierarchyTreeQuerySchema = z.object({
  family: hierarchyFamilySchema
});

export const hierarchyNodeIdSchema = z.string().uuid();

export const hierarchyNodeMutationModeSchema = z.enum(["folder", "record", "hybrid"]);

export const createHierarchyNodeSchema = z.object({
  family: hierarchyFamilySchema,
  parentId: z.string().uuid().nullable().optional(),
  nodeKind: hierarchyNodeKindSchema.default("folder"),
  nodeKey: nodeKeySchema,
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).max(100000).optional().default(0),
  allowRecordAssignment: z.boolean().optional().default(true),
  mutationMode: hierarchyNodeMutationModeSchema.optional(),
  canHaveChildren: z.boolean().optional(),
  canContainRecords: z.boolean().optional(),
  isActive: z.boolean().optional().default(true),
  metadata: jsonRecordSchema.optional().default({})
}).superRefine((value, ctx) => {
  if (!value.parentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["parentId"],
      message: "parentId is required for child node creation. Use the root seed endpoint for missing family roots."
    });
  }
});

export const ensureHierarchyRootSchema = z.object({
  family: hierarchyFamilySchema
});

export const updateHierarchyNodeSchema = z.object({
  nodeKind: hierarchyNodeKindSchema.optional(),
  nodeKey: nodeKeySchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  allowRecordAssignment: z.boolean().optional(),
  mutationMode: hierarchyNodeMutationModeSchema.optional(),
  canHaveChildren: z.boolean().optional(),
  canContainRecords: z.boolean().optional(),
  isActive: z.boolean().optional(),
  metadata: jsonRecordSchema.optional()
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field must be provided" });

export const archiveHierarchyNodeSchema = z.object({
  archived: z.boolean().default(true)
});

export const moveHierarchyNodeSchema = z.object({
  newParentId: z.string().uuid().nullable()
});

export const hierarchyNodeDetailsQuerySchema = z.object({
  id: hierarchyNodeIdSchema
});

export const hierarchyAllowedDestinationsQuerySchema = z.object({
  family: recordFamilySchema
});

export const createHierarchyDestinationSchema = z.object({
  family: recordFamilySchema,
  parentId: z.string().uuid(),
  nodeKind: hierarchyNodeKindSchema.refine((value) => value !== "root", { message: "Destination nodes cannot use the root kind" }).default("folder"),
  nodeKey: nodeKeySchema,
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).max(100000).optional().default(0),
  creationMode: z.enum(["record", "hybrid"]).optional().default("record"),
  metadata: jsonRecordSchema.optional().default({})
});

export const nodeRecordsQuerySchema = z.object({
  nodeId: z.string().uuid(),
  family: recordFamilySchema,
  includeDescendants: z.coerce.boolean().optional().default(true),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50)
});

export const nodeMediaQuerySchema = z.object({
  nodeId: z.string().uuid(),
  includeDescendants: z.coerce.boolean().optional().default(true),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100)
});

export const fieldsQuerySchema = z.object({
  family: hierarchyFamilySchema,
  nodeId: z.string().uuid().optional()
});

export const fieldOverrideInputSchema = z.object({
  nodeId: z.string().uuid(),
  overrideLabel: z.string().trim().min(1).max(120).nullable().optional(),
  isVisible: z.boolean().nullable().optional(),
  isRequired: z.boolean().nullable().optional(),
  isFilterable: z.boolean().nullable().optional(),
  isSortable: z.boolean().nullable().optional(),
  isGridVisible: z.boolean().nullable().optional(),
  isIntakeVisible: z.boolean().nullable().optional(),
  isDetailVisible: z.boolean().nullable().optional(),
  displayOrder: z.number().int().min(0).max(100000).nullable().optional(),
  widthPx: z.number().int().min(1).max(2000).nullable().optional(),
  optionsOverrideJson: jsonRecordSchema.nullable().optional(),
  validationOverrideJson: jsonRecordSchema.nullable().optional()
});

export const saveFieldDefinitionSchema = z.object({
  id: z.string().uuid().optional(),
  family: hierarchyFamilySchema,
  fieldKey: z.string().trim().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/i, "fieldKey must be alphanumeric/underscore"),
  defaultLabel: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  dataType: fieldDataTypeSchema,
  storageKind: fieldStorageKindSchema,
  coreColumnName: z.string().trim().min(1).max(100).nullable().optional(),
  isSystem: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  isVisibleDefault: z.boolean().optional().default(true),
  isRequiredDefault: z.boolean().optional().default(false),
  isFilterableDefault: z.boolean().optional().default(true),
  isSortableDefault: z.boolean().optional().default(true),
  isGridVisibleDefault: z.boolean().optional().default(true),
  isIntakeVisibleDefault: z.boolean().optional().default(true),
  isDetailVisibleDefault: z.boolean().optional().default(true),
  displayOrderDefault: z.number().int().min(0).max(100000).optional().default(100),
  optionsJson: jsonRecordSchema.optional().default({}),
  validationJson: jsonRecordSchema.optional().default({}),
  scopeMode: z.enum(["family", "selected_node"]).optional().default("family"),
  override: fieldOverrideInputSchema.optional()
}).superRefine((value, ctx) => {
  if (value.storageKind === "core_column" && !value.coreColumnName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coreColumnName"], message: "coreColumnName is required for core_column fields" });
  }
  if (value.storageKind === "custom_value" && value.coreColumnName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coreColumnName"], message: "coreColumnName must be omitted for custom_value fields" });
  }
  if (!value.id && value.storageKind === "core_column") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["storageKind"],
      message: "Creating new core_column fields from Hierarchy Manager is disabled. Create a custom value field instead."
    });
  }
  if (value.scopeMode === "selected_node") {
    if (!value.override?.nodeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["override", "nodeId"],
        message: "A selected-node field requires a nodeId override target."
      });
    }
    if (value.storageKind !== "custom_value") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storageKind"],
        message: "Selected-node fields must use custom_value storage."
      });
    }
  }
});

export const assignRecordToNodeSchema = z.object({
  family: recordFamilySchema,
  recordId: z.string().uuid(),
  nodeId: z.string().uuid()
});

export const customFieldValueInputSchema = z.object({
  fieldKey: z.string().trim().min(1).max(100),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), jsonRecordSchema, z.null()])
});

export const confirmHierarchyExtensionSchema = z.object({
  hierarchyNodeId: z.string().uuid().optional(),
  customFieldValues: z.array(customFieldValueInputSchema).optional().default([])
});
