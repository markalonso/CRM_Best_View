import "server-only";
import { z } from "zod";
import { getOpenAIClient } from "@/services/ai/openai-client";

export type IntakeType = "sale" | "rent" | "buyer" | "client" | "other";

type DetectResult = {
  detected_type: IntakeType;
  confidence: number;
  language: "ar" | "en" | "mixed";
  normalized_text: string;
  signals: string[];
};

type ValidateResult = {
  normalized_json: Record<string, string>;
  missing_fields: string[];
  confidence_map: Record<string, number>;
};

export type MultiListingResult = {
  multi_listing: boolean;
  segments: string[];
};

export class ExtractionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionParseError";
  }
}

const model = "gpt-4o-mini";

const detectSchema = z.object({
  detected_type: z.enum(["sale", "rent", "buyer", "client", "other"]),
  confidence: z.string().regex(/^\d{1,3}$/),
  language: z.enum(["ar", "en", "mixed"]),
  normalized_text: z.string(),
  signals: z.array(z.string()).default([])
});

const multiListingSchema = z.object({
  multi_listing: z.boolean(),
  segments: z.array(z.string()).default([])
});

const saleSchema = z.object({
  code: z.string().default(""),
  listing_type: z.literal("sale"),
  property_type: z.string().default(""),
  price: z.string().default(""),
  currency: z.string().default(""),
  size_sqm: z.string().default(""),
  bedrooms: z.string().default(""),
  bathrooms: z.string().default(""),
  location_area: z.string().default(""),
  compound: z.string().default(""),
  floor: z.string().default(""),
  furnished: z.string().default(""),
  finishing: z.string().default(""),
  payment_terms: z.string().default(""),
  contact_name: z.string().default(""),
  contact_phone: z.string().default(""),
  notes: z.string().default("")
});

const rentSchema = z.object({
  code: z.string().default(""),
  listing_type: z.literal("rent"),
  property_type: z.string().default(""),
  price: z.string().default(""),
  currency: z.string().default(""),
  size_sqm: z.string().default(""),
  bedrooms: z.string().default(""),
  bathrooms: z.string().default(""),
  location_area: z.string().default(""),
  compound: z.string().default(""),
  floor: z.string().default(""),
  furnished: z.string().default(""),
  finishing: z.string().default(""),
  payment_terms: z.string().default(""),
  contact_name: z.string().default(""),
  contact_phone: z.string().default(""),
  rent_period: z.string().default(""),
  notes: z.string().default("")
});

const buyerSchema = z.object({
  code: z.string().default(""),
  intent: z.string().default(""),
  budget_min: z.string().default(""),
  budget_max: z.string().default(""),
  currency: z.string().default(""),
  preferred_areas: z.string().default(""),
  property_type: z.string().default(""),
  bedrooms_needed: z.string().default(""),
  move_timeline: z.string().default(""),
  contact_name: z.string().default(""),
  contact_phone: z.string().default(""),
  notes: z.string().default("")
});

const clientSchema = z.object({
  code: z.string().default(""),
  client_type: z.string().default(""),
  name: z.string().default(""),
  phone: z.string().default(""),
  area: z.string().default(""),
  notes: z.string().default("")
});

const enumMaps = {
  furnished: ["", "fully_furnished", "semi_furnished", "not_furnished"],
  rent_period: ["", "daily", "weekly", "monthly", "yearly"],
  intent: ["", "buy", "rent"],
  client_type: ["", "owner", "seller", "landlord", "broker", "other"],
  currency: ["", "egp"]
} as const;

const criticalByType: Record<Exclude<IntakeType, "other">, string[]> = {
  sale: ["price", "location_area"],
  rent: ["price", "location_area"],
  buyer: ["budget_max", "preferred_areas"],
  client: ["name", "phone"]
};

const numericFields = new Set(["price", "size_sqm", "bedrooms", "bathrooms", "floor", "budget_min", "budget_max", "bedrooms_needed"]);

const extractionPromptBase = `General requirements for ALL extraction:
- temperature=0
- Return ONLY valid JSON object
- Use EXACT keys in EXACT order
- Never output null
- Missing => ""
- Numeric fields => digits only (stored as strings)
- Enum fields must be one of allowed values only
- If uncertain, leave "" and put the info in notes (short)

Normalization rules:
1) studio => bedrooms "0" ALWAYS + include "Studio" in notes if not mapped elsewhere
2) furnished enum only: "", "fully_furnished", "semi_furnished", "not_furnished"
3) location_area vs compound consistency:
   if place contains keywords: resort, compound, village, residence, heights, gardens, bay, marina
   then set BOTH location_area and compound to same extracted name.
4) notes:
   - only leftover info not mapped elsewhere
   - comma-separated, short
   - must include views/features like "Sea view", "Street view", "Balcony", "Maintenance", "Including furniture"
5) phone normalization:
   - keep digits only, preserve leading country code if present
6) currency normalization:
   - map "جنيه" "egp" "le" -> "egp"
   - do not output multiple variants`;

export const DETECT_TYPE_AND_LANGUAGE_PROMPT = `You are a strict CRM intake classifier.
Task: Given messy user text (Arabic/English/mixed, emojis, random order), classify into exactly one detected_type:
- sale
- rent
- buyer
- client
- other

Also detect language as exactly one of:
- ar
- en
- mixed

Return ONLY valid JSON with this exact shape:
{
  "detected_type":"",
  "confidence":"",
  "language":"",
  "normalized_text":"",
  "signals":[]
}

Hard rules:
1) confidence must be an integer string from 0 to 100 (no decimals).
2) normalized_text must keep meaning but clean spacing/newlines.
3) normalized_text must convert Arabic numerals to Western digits (١٢٣ -> 123).
4) normalized_text must standardize currency tokens: جنيه, ج, egp, le, l.e => EGP.
5) normalized_text must reduce repeated punctuation while keeping key tokens.
6) signals must be a short array of clues found in text (e.g. "for sale", "للبيع", "budget", "عايز اشتري", "مطلوب شقة").
7) If unclear between sale and rent, output detected_type="other" with low confidence.
8) If text is mainly about a person (name/phone/needs), choose buyer or client based on wording.
9) Never invent missing details. Use only evidence from the input.`;

const DETECT_MULTI_LISTING_PROMPT = `You split CRM intake text into listing segments.
Return ONLY valid JSON:
{
  "multi_listing": false,
  "segments": []
}

Rules:
- multi_listing=true only when there are clearly multiple listings/properties.
- Detect by repeated price patterns, multiple area mentions, list separators, numbering, or newline blocks.
- Support Arabic + English mixed text.
- If multi_listing=true, segments must contain each listing text independently.
- Keep each segment meaningful and concise.
- If uncertain, return multi_listing=false.
- Never merge multiple listings into one segment.`;

export function getSalePrompt() {
  return `${extractionPromptBase}\n\nReturn ONLY this JSON object exactly:\n{\n  "code":"",\n  "listing_type":"sale",\n  "property_type":"",\n  "price":"",\n  "currency":"",\n  "size_sqm":"",\n  "bedrooms":"",\n  "bathrooms":"",\n  "location_area":"",\n  "compound":"",\n  "floor":"",\n  "furnished":"",\n  "finishing":"",\n  "payment_terms":"",\n  "contact_name":"",\n  "contact_phone":"",\n  "notes":""\n}`;
}

export function getRentPrompt() {
  return `${extractionPromptBase}\n\nReturn ONLY this JSON object exactly:\n{\n  "code":"",\n  "listing_type":"rent",\n  "property_type":"",\n  "price":"",\n  "currency":"",\n  "size_sqm":"",\n  "bedrooms":"",\n  "bathrooms":"",\n  "location_area":"",\n  "compound":"",\n  "floor":"",\n  "furnished":"",\n  "finishing":"",\n  "payment_terms":"",\n  "contact_name":"",\n  "contact_phone":"",\n  "rent_period":"",\n  "notes":""\n}\nAllowed rent_period enum: "", "daily", "weekly", "monthly", "yearly"`;
}

export function getBuyerPrompt() {
  return `${extractionPromptBase}\n\nReturn ONLY this JSON object exactly:\n{\n  "code":"",\n  "intent":"",\n  "budget_min":"",\n  "budget_max":"",\n  "currency":"",\n  "preferred_areas":"",\n  "property_type":"",\n  "bedrooms_needed":"",\n  "move_timeline":"",\n  "contact_name":"",\n  "contact_phone":"",\n  "notes":""\n}\nAllowed intent enum: "", "buy", "rent"\npreferred_areas must be a single comma-separated string.`;
}

export function getClientPrompt() {
  return `${extractionPromptBase}\n\nReturn ONLY this JSON object exactly:\n{\n  "code":"",\n  "client_type":"",\n  "name":"",\n  "phone":"",\n  "area":"",\n  "notes":""\n}\nAllowed client_type enum: "", "owner", "seller", "landlord", "broker", "other"`;
}

function arabicToEnglishDigits(text: string) {
  const map: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
  return text.replace(/[٠-٩]/g, (d) => map[d] ?? d);
}

function normalizeCurrencyTokens(text: string) {
  return text.replace(/\b(egp|le|l\.e)\b/gi, "egp").replace(/(جنيه|ج\.?)(?=\s|$)/gi, "egp");
}

function normalizePunctuation(text: string) {
  return text.replace(/[!?.,،؛]{2,}/g, (m) => m[0]);
}

export function normalizeDetectedText(text: string) {
  return normalizePunctuation(normalizeCurrencyTokens(arabicToEnglishDigits(text))).replace(/\s+/g, " ").trim();
}

function digitsOnly(value: string) {
  return (arabicToEnglishDigits(value).match(/\d+/g) || []).join("");
}

function normalizeEnum(value: string, options: readonly string[]) {
  const raw = value.trim().toLowerCase();
  return options.includes(raw as never) ? raw : "";
}

function maybeLocationCompoundSync(locationArea: string, compound: string) {
  const place = `${locationArea} ${compound}`.trim();
  if (!place) return { location_area: locationArea, compound };
  if (/\b(resort|compound|village|residence|heights|gardens|bay|marina)\b/i.test(place)) {
    const normalized = place.replace(/\s+/g, " ").trim();
    return { location_area: normalized, compound: normalized };
  }
  return { location_area: locationArea, compound };
}

function extractFeatureNotes(text: string) {
  const features: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/sea view|اطلالة بحر|view sea/i, "Sea view"],
    [/street view|اطلالة شارع/i, "Street view"],
    [/balcony|بلكونة|تراس/i, "Balcony"],
    [/maintenance|صيانة/i, "Maintenance"],
    [/including furniture|with furniture|مفروش/i, "Including furniture"],
    [/studio|ستوديو/i, "Studio"]
  ];
  checks.forEach(([re, label]) => {
    if (re.test(text) && !features.includes(label)) features.push(label);
  });
  return features;
}

async function completeJson(messages: { role: "system" | "user"; content: string }[]) {
  const completion = await getOpenAIClient().chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages
  });
  return completion.choices[0]?.message?.content || "{}";
}

async function parseJsonWithRepair(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    const repaired = await completeJson([
      { role: "system", content: "Repair this into valid strict JSON object only. No markdown." },
      { role: "user", content: raw }
    ]);
    try {
      return JSON.parse(repaired);
    } catch {
      throw new ExtractionParseError("JSON parse failed after one repair attempt");
    }
  }
}

export function parseDetectModelPayload(payload: unknown): DetectResult {
  const parsed = detectSchema.parse(payload);
  return {
    detected_type: parsed.detected_type,
    confidence: Math.max(0, Math.min(100, parseInt(parsed.confidence, 10))),
    language: parsed.language,
    normalized_text: normalizeDetectedText(parsed.normalized_text),
    signals: parsed.signals
  };
}

export async function detectTypeAndLanguage(rawText: string): Promise<DetectResult> {
  const content = await completeJson([
    { role: "system", content: DETECT_TYPE_AND_LANGUAGE_PROMPT },
    { role: "user", content: rawText }
  ]);
  return parseDetectModelPayload(await parseJsonWithRepair(content));
}

export function heuristicSplitListings(rawText: string): MultiListingResult {
  const normalized = normalizeDetectedText(rawText);
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const numbered = rawText
    .split(/\n(?=(?:\d+[\).\-]|[-*•]\s+|(?:listing|unit|property|شقة|فيلا|دوبلكس|وحدة)\b))/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  const priceMatches = normalized.match(/(?:\b\d{5,}\b)\s*(?:egp|جنيه)?/gi) || [];
  const areaMatches = normalized.match(/(?:in|area|compound|منطقة|في|التجمع|المعادي|الشيخ زايد)\s+[\p{L}\d\- ]+/giu) || [];
  const separatorHits = (rawText.match(/(?:^|\n)\s*(?:\d+[\).\-]|[-*•])/gm) || []).length;

  if (numbered.length >= 2 && (priceMatches.length >= 2 || separatorHits >= 2 || lines.length >= 4)) {
    return { multi_listing: true, segments: numbered.slice(0, 10) };
  }

  if (lines.length >= 4 && priceMatches.length >= 2 && areaMatches.length >= 2) {
    const blocks = rawText.split(/\n\s*\n+/).map((s) => s.trim()).filter((s) => s.length > 20);
    if (blocks.length >= 2) {
      return { multi_listing: true, segments: blocks.slice(0, 10) };
    }
  }

  return { multi_listing: false, segments: [] };
}

export async function detectMultipleListings(rawText: string): Promise<MultiListingResult> {
  const heuristic = heuristicSplitListings(rawText);
  if (heuristic.multi_listing) return heuristic;

  const content = await completeJson([
    { role: "system", content: DETECT_MULTI_LISTING_PROMPT },
    { role: "user", content: rawText }
  ]);
  const parsed = multiListingSchema.parse(await parseJsonWithRepair(content));
  const segments = (parsed.segments || []).map((s) => normalizeDetectedText(String(s))).filter(Boolean);
  return { multi_listing: parsed.multi_listing && segments.length > 1, segments };
}

export async function extractByType(type: IntakeType, normalizedText: string): Promise<Record<string, unknown>> {
  if (type === "other") return {};

  const prompt = type === "sale" ? getSalePrompt() : type === "rent" ? getRentPrompt() : type === "buyer" ? getBuyerPrompt() : getClientPrompt();
  const content = await completeJson([
    { role: "system", content: prompt },
    { role: "user", content: normalizedText }
  ]);

  const parsed = await parseJsonWithRepair(content);

  if (type === "sale") return saleSchema.parse(parsed);
  if (type === "rent") return rentSchema.parse(parsed);
  if (type === "buyer") return buyerSchema.parse(parsed);
  return clientSchema.parse(parsed);
}

function normalizeNotes(existing: string, normalizedText: string) {
  const extra = extractFeatureNotes(normalizedText);
  const merged = [existing, ...extra].map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set(merged)).join(", ");
}

export function validateAndNormalize(type: IntakeType, extractedJson: Record<string, unknown>, normalizedText: string): ValidateResult {
  if (type === "other") {
    return { normalized_json: { notes: normalizeDetectedText(normalizedText) }, missing_fields: [], confidence_map: { notes: 0.7 } };
  }

  const normalizedTextSafe = normalizeDetectedText(normalizedText);
  const confidenceMapRaw = (extractedJson.confidence_map || {}) as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  const confidence_map: Record<string, number> = {};

  const set = (k: string, v: string) => {
    normalized[k] = v ?? "";
    const c = Number(confidenceMapRaw[k]);
    confidence_map[k] = Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : normalized[k] ? 0.82 : 0.2;
  };

  if (type === "sale" || type === "rent") {
    const src = (type === "sale" ? saleSchema : rentSchema).parse(extractedJson);
    const synced = maybeLocationCompoundSync(String(src.location_area || ""), String(src.compound || ""));
    set("code", String(src.code || ""));
    set("listing_type", type);
    set("property_type", String(src.property_type || ""));
    set("price", digitsOnly(String(src.price || "")));
    set("currency", normalizeEnum(normalizeCurrencyTokens(String(src.currency || "")).toLowerCase(), enumMaps.currency));
    set("size_sqm", digitsOnly(String(src.size_sqm || "")));

    const bedroomsRaw = String(src.bedrooms || "");
    const bedroomsStudio = /\bstudio\b|ستوديو/i.test(`${bedroomsRaw} ${normalizedTextSafe}`) ? "0" : digitsOnly(bedroomsRaw);
    set("bedrooms", bedroomsStudio);

    set("bathrooms", digitsOnly(String(src.bathrooms || "")));
    set("location_area", synced.location_area);
    set("compound", synced.compound);
    set("floor", digitsOnly(String(src.floor || "")));
    set("furnished", normalizeEnum(String(src.furnished || ""), enumMaps.furnished));
    set("finishing", String(src.finishing || ""));
    set("payment_terms", String(src.payment_terms || ""));
    set("contact_name", String(src.contact_name || ""));
    set("contact_phone", digitsOnly(String(src.contact_phone || "")));
    if (type === "rent") set("rent_period", normalizeEnum(String((src as z.infer<typeof rentSchema>).rent_period || ""), enumMaps.rent_period));
    set("notes", normalizeNotes(String(src.notes || ""), normalizedTextSafe));
  }

  if (type === "buyer") {
    const src = buyerSchema.parse(extractedJson);
    set("code", String(src.code || ""));
    set("intent", normalizeEnum(String(src.intent || ""), enumMaps.intent));
    set("budget_min", digitsOnly(String(src.budget_min || "")));
    set("budget_max", digitsOnly(String(src.budget_max || "")));
    set("currency", normalizeEnum(normalizeCurrencyTokens(String(src.currency || "")).toLowerCase(), enumMaps.currency));
    set("preferred_areas", String(src.preferred_areas || "").split(",").map((v) => v.trim()).filter(Boolean).join(", "));
    set("property_type", String(src.property_type || ""));
    set("bedrooms_needed", digitsOnly(String(src.bedrooms_needed || "")));
    set("move_timeline", String(src.move_timeline || ""));
    set("contact_name", String(src.contact_name || ""));
    set("contact_phone", digitsOnly(String(src.contact_phone || "")));
    set("notes", normalizeNotes(String(src.notes || ""), normalizedTextSafe));
  }

  if (type === "client") {
    const src = clientSchema.parse(extractedJson);
    set("code", String(src.code || ""));
    set("client_type", normalizeEnum(String(src.client_type || ""), enumMaps.client_type));
    set("name", String(src.name || ""));
    set("phone", digitsOnly(String(src.phone || "")));
    set("area", String(src.area || ""));
    set("notes", normalizeNotes(String(src.notes || ""), normalizedTextSafe));
  }

  const missing_fields = criticalByType[type].filter((field) => !normalized[field]);
  return { normalized_json: normalized, missing_fields, confidence_map };
}
