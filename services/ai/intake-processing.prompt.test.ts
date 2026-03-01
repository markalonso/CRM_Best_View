import assert from "node:assert/strict";
import test from "node:test";
import {
  DETECT_TYPE_AND_LANGUAGE_PROMPT,
  getSalePrompt,
  getRentPrompt,
  getBuyerPrompt,
  getClientPrompt,
  normalizeDetectedText,
  heuristicSplitListings,
  parseDetectModelPayload,
  validateAndNormalize
} from "@/services/ai/intake-processing.service";

test("detect prompt contains strict required rules", () => {
  assert.ok(DETECT_TYPE_AND_LANGUAGE_PROMPT.includes("detected_type"));
  assert.ok(DETECT_TYPE_AND_LANGUAGE_PROMPT.includes("confidence must be an integer string from 0 to 100"));
  assert.ok(DETECT_TYPE_AND_LANGUAGE_PROMPT.includes("If unclear between sale and rent"));
  assert.ok(DETECT_TYPE_AND_LANGUAGE_PROMPT.includes("Never invent missing details"));
});

test("sale extraction prompt includes exact listing_type and order hints", () => {
  const p = getSalePrompt();
  assert.ok(p.includes('"listing_type":"sale"'));
  assert.ok(p.includes('"location_area":""'));
  assert.ok(p.includes('"notes":""'));
});

test("rent extraction prompt contains rent_period enum guidance", () => {
  const p = getRentPrompt();
  assert.ok(p.includes('"listing_type":"rent"'));
  assert.ok(p.includes('"rent_period":""'));
  assert.ok(p.includes('daily'));
});

test("buyer extraction prompt contains exact buyer schema keys", () => {
  const p = getBuyerPrompt();
  assert.ok(p.includes('"intent":""'));
  assert.ok(p.includes('"preferred_areas":""'));
  assert.ok(p.includes('comma-separated'));
});

test("client extraction prompt contains exact client_type enum", () => {
  const p = getClientPrompt();
  assert.ok(p.includes('"client_type":""'));
  assert.ok(p.includes('"broker"'));
});

test("example 1: Arabic sale listing", () => {
  const parsed = parseDetectModelPayload({
    detected_type: "sale",
    confidence: "92",
    language: "ar",
    normalized_text: "شقة للبيع ٣ غرف ١٦٠ متر ٥,٥٠٠,٠٠٠ جنيه!!!",
    signals: ["للبيع", "شقة"]
  });
  assert.equal(parsed.detected_type, "sale");
  assert.equal(parsed.language, "ar");
  assert.equal(parsed.normalized_text.includes("5500000"), true);
  assert.equal(parsed.normalized_text.includes("egp"), true);
});

test("example 2: English rent listing", () => {
  const parsed = parseDetectModelPayload({
    detected_type: "rent",
    confidence: "88",
    language: "en",
    normalized_text: "Apartment for rent, 2 bedrooms, 35,000 le...",
    signals: ["for rent", "apartment"]
  });
  assert.equal(parsed.detected_type, "rent");
  assert.equal(parsed.language, "en");
  assert.equal(parsed.normalized_text.includes("egp"), true);
});

test("example 3: Buyer requirements (budget, areas)", () => {
  const parsed = parseDetectModelPayload({
    detected_type: "buyer",
    confidence: "90",
    language: "mixed",
    normalized_text: "مطلوب شقة للشراء budget ٤٠٠٠٠٠٠ في New Cairo",
    signals: ["مطلوب شقة", "budget"]
  });
  assert.equal(parsed.detected_type, "buyer");
  assert.equal(parsed.language, "mixed");
  assert.equal(parsed.normalized_text.includes("4000000"), true);
});

test("example 4: Client/owner contact details", () => {
  const parsed = parseDetectModelPayload({
    detected_type: "client",
    confidence: "86",
    language: "mixed",
    normalized_text: "Owner Ahmed, phone 01001234567, لديه شقة",
    signals: ["owner", "phone"]
  });
  assert.equal(parsed.detected_type, "client");
  assert.equal(parsed.language, "mixed");
});

test("example 5: Totally unrelated text -> other", () => {
  const parsed = parseDetectModelPayload({
    detected_type: "other",
    confidence: "24",
    language: "en",
    normalized_text: "Happy birthday!!! let's meet tonight",
    signals: ["social chat"]
  });
  assert.equal(parsed.detected_type, "other");
  assert.equal(parsed.confidence, 24);
});

test("validateAndNormalize enforces studio/enum/currency/phone/location rules", () => {
  const out = validateAndNormalize(
    "sale",
    {
      code: "",
      listing_type: "sale",
      property_type: "apartment",
      price: "٥٥٠٠٠٠٠ جنيه",
      currency: "le",
      size_sqm: "١٦٠",
      bedrooms: "studio",
      bathrooms: "2",
      location_area: "Marina Bay",
      compound: "",
      floor: "3",
      furnished: "fully_furnished",
      finishing: "super lux",
      payment_terms: "cash",
      contact_name: "Ahmed",
      contact_phone: "+20 101-555-2222",
      notes: "Sea view"
    },
    "Studio with sea view at marina bay"
  );

  assert.equal(out.normalized_json.bedrooms, "0");
  assert.equal(out.normalized_json.currency, "egp");
  assert.equal(out.normalized_json.contact_phone, "201015552222");
  assert.equal(out.normalized_json.location_area.includes("Marina Bay"), true);
  assert.equal(out.normalized_json.compound.includes("Marina Bay"), true);
  assert.equal(out.normalized_json.notes.includes("Sea view"), true);
});

test("normalizeDetectedText performs numeral/currency/punctuation cleanup", () => {
  const out = normalizeDetectedText("السعر ١٢٠٠٠ جنيه!!!!   \n\n location...");
  assert.equal(out.includes("12000"), true);
  assert.equal(out.includes("egp"), true);
  assert.equal(out.includes("!!!!"), false);
});

test("heuristicSplitListings detects numbered multi-listings", () => {
  const out = heuristicSplitListings(`1) شقة للبيع 3500000 جنيه في التجمع\n2) شقة للبيع 4200000 جنيه في المعادي`);
  assert.equal(out.multi_listing, true);
  assert.equal(out.segments.length >= 2, true);
});

test("heuristicSplitListings stays single for one listing", () => {
  const out = heuristicSplitListings("Apartment for sale in New Cairo price 5500000 EGP, 3 bedrooms");
  assert.equal(out.multi_listing, false);
  assert.equal(out.segments.length, 0);
});
