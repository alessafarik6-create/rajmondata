/**
 * Deterministické parsování polí poptávky a kontrola required/optional/ignored.
 */

import type { AiInquiryTypeRuleDoc } from "@/lib/ai/ai-settings-types";
import { normalizeInquiryTypeLabel } from "@/lib/ai/inquiry-type-rules";
import { parseInquiryDimensions, type ParsedInquiryDimensions } from "@/lib/ai/dimension-parser";

export type InquiryFieldKey =
  | "width"
  | "depth"
  | "roofType"
  | "color"
  | "constructionVariant"
  | "quantity"
  | "sideGlazing"
  | "winterGardenDoors"
  | "slidingGlass"
  | "dimensions"
  | "area";

export const DEFAULT_PERGOLA_FIELD_KEYS = {
  requiredFields: ["width", "depth", "roofType"] as InquiryFieldKey[],
  optionalFields: ["color", "constructionVariant", "quantity"] as InquiryFieldKey[],
  ignoredFields: ["sideGlazing", "winterGardenDoors", "slidingGlass"] as InquiryFieldKey[],
  defaultQuantity: 1,
};

const FIELD_LABELS_CS: Record<InquiryFieldKey, string> = {
  width: "šířka",
  depth: "hloubka / délka",
  roofType: "typ střechy / zastřešení",
  color: "barva",
  constructionVariant: "konstrukční varianta",
  quantity: "počet kusů",
  sideGlazing: "boční zasklení",
  winterGardenDoors: "dveře zimní zahrady",
  slidingGlass: "posuvné sklo",
  dimensions: "rozměry",
  area: "plocha",
};

const ROOF_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /polykarbon[aá]t(?:\s*\d+\s*mm)?/i, label: "polykarbonát" },
  { re: /sklo(?:\s*\d+\s*mm)?/i, label: "sklo" },
  { re: /trap(?:e)?z(?:ov[aá])?\s*plech/i, label: "trapézový plech" },
  { re: /plech(?:ov[aá])?\s*st[eě]ch/i, label: "plechová střecha" },
  { re: /hlin[ií]k(?:ov[aá])?\s*st[eě]ch/i, label: "hliníková střecha" },
  { re: /lat(?:ov[aá])?\s*st[eě]ch/i, label: "latění střechy" },
  { re: /st[eě]ch(?:a|u|e)?/i, label: "střecha" },
];

const FIELD_PHRASES: Record<InquiryFieldKey, string[]> = {
  width: ["sirka", "šířka", "width"],
  depth: ["hloubka", "delka", "délka", "depth", "length"],
  roofType: [
    "strecha",
    "střecha",
    "zastreseni",
    "zastřešení",
    "polykarbonat",
    "polykarbonát",
    "sklo",
    "plech",
    "roof",
  ],
  color: ["barva", "barvy", "color", "odstin", "odstín", "antracit", "bila", "bílá"],
  constructionVariant: [
    "konstrukcni",
    "konstrukční",
    "varianta",
    "provedeni",
    "provedení",
    "model",
  ],
  quantity: ["pocet", "počet", "kus", "ks", "mnozstvi", "množství", "quantity"],
  sideGlazing: ["bocni zaskleni", "boční zasklení", "side glazing"],
  winterGardenDoors: ["dvere zimni", "dveře zimní", "winter garden doors"],
  slidingGlass: ["posuvne sklo", "posuvné sklo", "sliding glass"],
  dimensions: ["rozmer", "rozměr", "rozmery", "rozměry", "dimension"],
  area: ["plocha", "m2", "m²"],
};

export type ParsedInquiryFields = {
  dimensions: ParsedInquiryDimensions;
  roofMaterial: string | null;
  quantity: number;
  requiredFields: InquiryFieldKey[];
  optionalFields: InquiryFieldKey[];
  ignoredFields: InquiryFieldKey[];
  satisfiedRequired: InquiryFieldKey[];
  missingRequired: InquiryFieldKey[];
  fieldChecks: Record<InquiryFieldKey, boolean | null>;
};

export function resolveTypeRuleFieldKeys(rule: AiInquiryTypeRuleDoc): {
  requiredFields: InquiryFieldKey[];
  optionalFields: InquiryFieldKey[];
  ignoredFields: InquiryFieldKey[];
  defaultQuantity: number;
} {
  const structuredRequired = (rule.requiredFields?.length
    ? rule.requiredFields
    : inferFieldKeysFromLabels(rule.requiredInformation, "required")) as InquiryFieldKey[];
  const structuredOptional = (rule.optionalFields?.length
    ? rule.optionalFields
    : inferFieldKeysFromLabels(rule.optionalInformation, "optional")) as InquiryFieldKey[];
  const structuredIgnored = (rule.ignoredFields?.length
    ? rule.ignoredFields
    : inferFieldKeysFromLabels(rule.ignoredInformation, "ignored")) as InquiryFieldKey[];

  if (rule.name === "Pergoly svépomocí" && !rule.requiredFields?.length) {
    return {
      requiredFields: DEFAULT_PERGOLA_FIELD_KEYS.requiredFields,
      optionalFields: DEFAULT_PERGOLA_FIELD_KEYS.optionalFields,
      ignoredFields: structuredIgnored.length
        ? structuredIgnored
        : DEFAULT_PERGOLA_FIELD_KEYS.ignoredFields,
      defaultQuantity: rule.defaultQuantity ?? DEFAULT_PERGOLA_FIELD_KEYS.defaultQuantity,
    };
  }

  return {
    requiredFields: structuredRequired,
    optionalFields: structuredOptional,
    ignoredFields: structuredIgnored,
    defaultQuantity: rule.defaultQuantity ?? 1,
  };
}

function inferFieldKeysFromLabels(labels: string[], _kind: string): InquiryFieldKey[] {
  const keys = new Set<InquiryFieldKey>();
  for (const label of labels) {
    const n = normalizeInquiryTypeLabel(label);
    if (!n) continue;
    for (const [key, phrases] of Object.entries(FIELD_PHRASES) as Array<[InquiryFieldKey, string[]]>) {
      if (phrases.some((p) => n.includes(normalizeInquiryTypeLabel(p)))) {
        keys.add(key);
      }
    }
    if (n.includes("rozmer") || n.includes("sirka") || n.includes("delka")) {
      keys.add("width");
      keys.add("depth");
    }
    if (n.includes("strech") || n.includes("zastresen")) keys.add("roofType");
  }
  return [...keys];
}

function detectRoofMaterial(text: string): string | null {
  const polyMatch = /polykarbon[aá]t(?:\s*(\d+)\s*mm)?/i.exec(text);
  if (polyMatch) {
    return polyMatch[1] ? `polykarbonát ${polyMatch[1]} mm` : "polykarbonát";
  }
  for (const { re, label } of ROOF_PATTERNS) {
    if (re.test(text) && !re.source.includes("polykarbon")) return label;
  }
  return null;
}

function detectExplicitQuantity(text: string): number | null {
  const plural = /\b(\d+)\s*(?:ks|kus[uů]?|pergol|zahrad)/i.exec(text);
  if (plural && Number(plural[1]) > 1) return Number(plural[1]);
  const qty = /\bpo[cč]et\s*[:\s]?\s*(\d+)/i.exec(text);
  if (qty) return Number(qty[1]);
  return null;
}

function isFieldSatisfied(
  key: InquiryFieldKey,
  text: string,
  dims: ParsedInquiryDimensions,
  roofMaterial: string | null,
  quantity: number
): boolean {
  const n = normalizeInquiryTypeLabel(text);
  switch (key) {
    case "width":
      return dims.widthMm != null && dims.widthMm > 0;
    case "depth":
      return dims.depthMm != null && dims.depthMm > 0;
    case "dimensions":
      return (
        (dims.widthMm != null && dims.depthMm != null) ||
        (dims.areaM2 != null && dims.areaM2 > 0)
      );
    case "area":
      return dims.areaM2 != null && dims.areaM2 > 0;
    case "roofType":
      return roofMaterial != null || FIELD_PHRASES.roofType.some((p) => n.includes(normalizeInquiryTypeLabel(p)));
    case "quantity":
      return quantity > 0;
    case "color":
    case "constructionVariant":
      return FIELD_PHRASES[key].some((p) => n.includes(normalizeInquiryTypeLabel(p)));
    default:
      return false;
  }
}

export function parseInquiryFields(
  inquiryText: string,
  typeRule: AiInquiryTypeRuleDoc
): ParsedInquiryFields {
  const text = String(inquiryText ?? "").trim();
  const dims = parseInquiryDimensions(text);
  const roofMaterial = detectRoofMaterial(text);
  const keys = resolveTypeRuleFieldKeys(typeRule);
  const explicitQty = detectExplicitQuantity(text);
  const quantity = explicitQty ?? keys.defaultQuantity;

  const fieldChecks = {} as Record<InquiryFieldKey, boolean | null>;
  const allKeys: InquiryFieldKey[] = [
    "width",
    "depth",
    "roofType",
    "color",
    "constructionVariant",
    "quantity",
    "sideGlazing",
    "winterGardenDoors",
    "slidingGlass",
    "dimensions",
    "area",
  ];
  for (const key of allKeys) {
    fieldChecks[key] = isFieldSatisfied(key, text, dims, roofMaterial, quantity);
  }

  const satisfiedRequired: InquiryFieldKey[] = [];
  const missingRequired: InquiryFieldKey[] = [];
  for (const key of keys.requiredFields) {
    if (isFieldSatisfied(key, text, dims, roofMaterial, quantity)) {
      satisfiedRequired.push(key);
    } else {
      missingRequired.push(key);
    }
  }

  return {
    dimensions: dims,
    roofMaterial,
    quantity,
    requiredFields: keys.requiredFields,
    optionalFields: keys.optionalFields,
    ignoredFields: keys.ignoredFields,
    satisfiedRequired,
    missingRequired,
    fieldChecks,
  };
}

export function missingTextMatchesFieldKey(missingItem: string, key: InquiryFieldKey): boolean {
  const item = normalizeInquiryTypeLabel(missingItem);
  if (!item) return false;
  const phrases = FIELD_PHRASES[key] ?? [];
  if (phrases.some((p) => item.includes(normalizeInquiryTypeLabel(p)))) return true;
  const label = normalizeInquiryTypeLabel(FIELD_LABELS_CS[key]);
  return item.includes(label) || label.includes(item);
}

export function missingItemMatchesAnyFieldKey(
  missingItem: string,
  keys: InquiryFieldKey[]
): boolean {
  return keys.some((k) => missingTextMatchesFieldKey(missingItem, k));
}

export function fieldKeyLabel(key: InquiryFieldKey): string {
  return FIELD_LABELS_CS[key] ?? key;
}
