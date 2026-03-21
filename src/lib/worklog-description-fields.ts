import type { EmployeeUiLang } from "@/lib/i18n/employee-ui";

export type WorklogTextLanguage = "cs" | "ua";

/** Zobrazovaný / legacy text — původní význam práce. */
export function getWorklogDescriptionOriginal(data: {
  description_original?: unknown;
  description?: unknown;
}): string {
  const o = data.description_original;
  if (typeof o === "string" && o.trim()) return o.trim();
  const d = data.description;
  return typeof d === "string" ? d.trim() : "";
}

export function getWorklogLanguage(data: {
  language?: unknown;
  description_original?: unknown;
}): WorklogTextLanguage {
  if (data.language === "ua" || data.language === "cs") return data.language;
  return "cs";
}

export function buildWorklogDescriptionPayload(
  normalizedDescription: string,
  lang: WorklogTextLanguage
): {
  description: string;
  description_original: string;
  language: WorklogTextLanguage;
} {
  return {
    description: normalizedDescription,
    description_original: normalizedDescription,
    language: lang,
  };
}

export function mergeWorklogDescriptionsForBlocks(
  parts: string[],
  lang: EmployeeUiLang
): {
  description: string;
  description_original: string;
  language: WorklogTextLanguage;
} {
  const joined = parts.filter(Boolean).join(" · ");
  const wl: WorklogTextLanguage = lang === "ua" ? "ua" : "cs";
  return buildWorklogDescriptionPayload(joined, wl);
}
