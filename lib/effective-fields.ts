import type { EffectiveFieldDefinition, FieldDataType, HierarchyFamily } from "@/types/hierarchy";

export type ReviewType = "sale" | "rent" | "buyer" | "client" | "other";
export type GridType = "sale" | "rent" | "buyer" | "client";

const legacyAiAliases: Record<string, string[]> = {
  source: ["source", "code"],
  area: ["area", "location_area"],
  role: ["role", "client_type"],
  timeline: ["timeline", "move_timeline"],
  preferred_areas: ["preferred_areas"],
  name: ["name", "contact_name"],
  phone: ["phone", "contact_phone"]
};

export function reviewTypeToHierarchyFamily(type: ReviewType): Exclude<HierarchyFamily, "media"> | null {
  if (type === "sale") return "sale";
  if (type === "rent") return "rent";
  if (type === "buyer") return "buyers";
  if (type === "client") return "clients";
  return null;
}

export function reviewTypeToGridType(type: Exclude<ReviewType, "other">): GridType {
  if (type === "sale") return "sale";
  if (type === "rent") return "rent";
  if (type === "buyer") return "buyer";
  return "client";
}

export function formatFieldValueForInput(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  if (value === null || value === undefined) return "";
  return String(value);
}

export function resolveAiValueForField(field: EffectiveFieldDefinition, aiJson: Record<string, unknown>) {
  const aliases = Array.from(new Set([
    field.field_key,
    field.core_column_name || "",
    ...(legacyAiAliases[field.field_key] || []),
    ...(field.core_column_name ? legacyAiAliases[field.core_column_name] || [] : [])
  ].filter(Boolean)));

  for (const alias of aliases) {
    const value = aiJson[alias];
    if (value !== undefined && value !== null && String(value) !== "") return value;
  }

  return "";
}

function normalizeBooleanString(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(normalized)) return true;
  if (["false", "no", "0", "n"].includes(normalized)) return false;
  return value;
}

function normalizeNumericInput(value: string, dataType: FieldDataType) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return value;
  return dataType === "integer" ? Math.trunc(numeric) : numeric;
}

export function parseFieldInputValue(field: EffectiveFieldDefinition, rawValue: unknown) {
  if (rawValue === null || rawValue === undefined) return null;
  if (typeof rawValue !== "string") return rawValue;

  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  if (field.data_type === "integer" || field.data_type === "number") {
    return normalizeNumericInput(trimmed, field.data_type);
  }

  if (field.data_type === "boolean") {
    return normalizeBooleanString(trimmed);
  }

  if (field.data_type === "multi_select") {
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }

  if (field.data_type === "json") {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

export function isFieldValueEmpty(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
