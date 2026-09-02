/**
 * Post-processing missing_information a customer_reply dle pravidel typu poptávky.
 */

import type { AiInquiryTypeRuleDoc } from "@/lib/ai/ai-settings-types";
import {
  filterIgnoredMissingInformation,
  isIgnoredMissingInformation,
} from "@/lib/ai/inquiry-type-rules";
import {
  fieldKeyLabel,
  missingItemMatchesAnyFieldKey,
  parseInquiryFields,
  type ParsedInquiryFields,
} from "@/lib/ai/inquiry-field-parser";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function filterOptionalMissingInformation(
  missing: string[],
  optionalFields: ParsedInquiryFields["optionalFields"]
): string[] {
  if (optionalFields.length === 0) return missing;
  return missing.filter((m) => !missingItemMatchesAnyFieldKey(m, optionalFields));
}

export function filterSatisfiedRequiredMissing(
  missing: string[],
  parsed: ParsedInquiryFields
): string[] {
  return missing.filter((m) => {
    for (const key of parsed.satisfiedRequired) {
      if (missingItemMatchesAnyFieldKey(m, [key])) return false;
    }
    return true;
  });
}

export function resolveAiMissingInformation(params: {
  rawMissing: string[];
  typeRule: AiInquiryTypeRuleDoc;
  inquiryText: string;
}): {
  missingInformation: string[];
  parsedFields: ParsedInquiryFields;
  strippedOptional: number;
  strippedIgnored: number;
  strippedSatisfied: number;
} {
  const parsedFields = parseInquiryFields(params.inquiryText, params.typeRule);
  const raw = params.rawMissing.map((s) => s.trim()).filter(Boolean);

  const afterIgnored = filterIgnoredMissingInformation(
    raw,
    params.typeRule.ignoredInformation
  );
  const strippedIgnored = raw.length - afterIgnored.length;

  const afterOptional = filterOptionalMissingInformation(
    afterIgnored,
    parsedFields.optionalFields
  );
  const strippedOptional = afterIgnored.length - afterOptional.length;

  const afterOptionalKeys = afterOptional.filter(
    (m) => !missingItemMatchesAnyFieldKey(m, parsedFields.optionalFields)
  );
  const afterSatisfied = filterSatisfiedRequiredMissing(afterOptionalKeys, parsedFields);
  const strippedSatisfied = afterOptionalKeys.length - afterSatisfied.length;

  const deterministicMissing = parsedFields.missingRequired.map((k) => fieldKeyLabel(k));

  const merged = [...afterSatisfied];
  for (const req of deterministicMissing) {
    const already = merged.some(
      (m) => normalize(m).includes(normalize(req)) || normalize(req).includes(normalize(m))
    );
    if (!already) merged.push(req);
  }

  const finalMissing = merged.filter((m) => {
    if (isIgnoredMissingInformation(m, params.typeRule.ignoredInformation)) return false;
    if (missingItemMatchesAnyFieldKey(m, parsedFields.optionalFields)) return false;
    if (missingItemMatchesAnyFieldKey(m, parsedFields.ignoredFields)) return false;
    for (const key of parsedFields.satisfiedRequired) {
      if (missingItemMatchesAnyFieldKey(m, [key])) return false;
    }
    return true;
  });

  return {
    missingInformation: finalMissing,
    parsedFields,
    strippedOptional,
    strippedIgnored,
    strippedSatisfied,
  };
}

const REQUEST_PHRASES = [
  "prosime o doplneni",
  "prosíme o doplnění",
  "potrebujeme doplnit",
  "potřebujeme doplnit",
  "uvedte prosim",
  "uveďte prosím",
  "doplnit informaci",
  "doplnění informace",
  "doplnit udaje",
  "doplnění údaj",
  "pro vytvoreni nabidky",
  "pro vytvoření nabídky",
  "pred vytvorenim nabidky",
  "před vytvořením nabídky",
];

export function sanitizeCustomerReply(params: {
  customerReply: string;
  missingInformation: string[];
  inquiryType: string;
  parsedFields: ParsedInquiryFields;
  summary?: string;
}): string {
  if (params.missingInformation.length > 0) {
    return params.customerReply.trim();
  }

  let reply = params.customerReply.trim();
  const n = normalize(reply);
  const looksLikeRequest = REQUEST_PHRASES.some((p) => n.includes(normalize(p)));
  const mentionsOptionalOnly =
    missingItemMatchesAnyFieldKey(reply, params.parsedFields.optionalFields) &&
    params.parsedFields.missingRequired.length === 0;

  if (!looksLikeRequest && !mentionsOptionalOnly) {
    return reply;
  }

  const dims = params.parsedFields.dimensions;
  const dimPart =
    dims.widthMm != null && dims.depthMm != null
      ? `${Math.round(dims.widthMm / 100) / 10} × ${Math.round(dims.depthMm / 100) / 10} m`
      : dims.areaM2 != null
        ? `${dims.areaM2} m²`
        : null;
  const roofPart = params.parsedFields.roofMaterial
    ? ` se zastřešením (${params.parsedFields.roofMaterial})`
    : "";

  const typeLabel = params.inquiryType || "poptávku";
  const intro = `Dobrý den,\nděkujeme za Vaši poptávku ${typeLabel}${dimPart ? ` o rozměru ${dimPart}` : ""}${roofPart}.`;
  const body =
    params.summary?.trim() ||
    "Na základě zadaných údajů jsme pro Vás připravili návrh nabídky. Níže naleznete navrhované položky a orientační strukturu nabídky — finální cenu určí náš obchodní tým z aktuálního ceníku.";
  const optionalNote =
    params.parsedFields.optionalFields.includes("color") &&
    !params.parsedFields.fieldChecks.color
      ? "\n\nPokud budete chtít, můžeme následně upřesnit barevné provedení."
      : "";

  return `${intro}\n\n${body}${optionalNote}`.trim();
}
