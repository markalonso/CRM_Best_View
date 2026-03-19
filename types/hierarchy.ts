export type HierarchyFamily = "sale" | "rent" | "buyers" | "clients" | "media";

export type HierarchyNodeKind = "root" | "folder" | "project" | "building" | "unit" | "phase" | "custom";

export type FieldStorageKind = "core_column" | "custom_value";

export type FieldDataType =
  | "text"
  | "long_text"
  | "integer"
  | "number"
  | "boolean"
  | "date"
  | "timestamp"
  | "single_select"
  | "multi_select"
  | "json";

export type CRMRecordFamily = Exclude<HierarchyFamily, "media">;
export type ReviewHierarchyType = "sale" | "rent" | "buyer" | "client";

export interface HierarchyNode {
  id: string;
  family: HierarchyFamily;
  parent_id: string | null;
  node_kind: HierarchyNodeKind;
  node_key: string;
  name: string;
  path_text: string;
  depth: number;
  sort_order: number;
  allow_record_assignment: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HierarchyTreeNode extends HierarchyNode {
  children: HierarchyTreeNode[];
}

export interface FieldDefinition {
  id: string;
  family: HierarchyFamily;
  field_key: string;
  default_label: string;
  description: string | null;
  data_type: FieldDataType;
  storage_kind: FieldStorageKind;
  core_column_name: string | null;
  is_system: boolean;
  is_active: boolean;
  is_visible_default: boolean;
  is_required_default: boolean;
  is_filterable_default: boolean;
  is_sortable_default: boolean;
  is_grid_visible_default: boolean;
  is_intake_visible_default: boolean;
  is_detail_visible_default: boolean;
  display_order_default: number;
  options_json: Record<string, unknown>;
  validation_json: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HierarchyFieldOverride {
  id: string;
  node_id: string;
  field_definition_id: string;
  override_label: string | null;
  is_visible: boolean | null;
  is_required: boolean | null;
  is_filterable: boolean | null;
  is_sortable: boolean | null;
  is_grid_visible: boolean | null;
  is_intake_visible: boolean | null;
  is_detail_visible: boolean | null;
  display_order: number | null;
  width_px: number | null;
  options_override_json: Record<string, unknown> | null;
  validation_override_json: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EffectiveFieldDefinition extends FieldDefinition {
  effective_label: string;
  effective_visible: boolean;
  effective_required: boolean;
  effective_filterable: boolean;
  effective_sortable: boolean;
  effective_grid_visible: boolean;
  effective_intake_visible: boolean;
  effective_detail_visible: boolean;
  effective_display_order: number;
  effective_width_px: number | null;
  effective_options_json: Record<string, unknown>;
  effective_validation_json: Record<string, unknown>;
  override_source_node_id: string | null;
}

export interface RecordHierarchyLink {
  id: string;
  node_id: string;
  sale_id: string | null;
  rent_id: string | null;
  buyer_id: string | null;
  client_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MediaHierarchyLink {
  id: string;
  media_id: string;
  node_id: string;
  is_primary: boolean;
  created_by: string | null;
  created_at: string;
}

export interface RecordCustomFieldValue {
  id: string;
  field_definition_id: string;
  sale_id: string | null;
  rent_id: string | null;
  buyer_id: string | null;
  client_id: string | null;
  media_id: string | null;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  value_date: string | null;
  value_timestamp: string | null;
  value_json: Record<string, unknown> | unknown[] | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
