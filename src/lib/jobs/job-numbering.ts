/**
 * Automatické číslování zakázek — konfigurace, formátování a klíče čítačů.
 */

export type JobNumberingTypeRule = {
  id: string;
  name: string;
  prefix: string;
  /** Např. {PREFIX}{SEQ:4} nebo {PREFIX}-{YEAR}-{SEQ:3} */
  format: string;
  /** Volitelná vazba na jobTag (case-insensitive contains or exact) */
  jobTagMatch?: string;
  startSequence?: number;
  /** Neaktivní řada se nenabízí při zakládání */
  active?: boolean;
};

export type JobNumberingSettings = {
  resetYearly: boolean;
  types: JobNumberingTypeRule[];
  defaultTypeId: string;
};

export const DEFAULT_JOB_NUMBERING_SETTINGS: JobNumberingSettings = {
  resetYearly: true,
  defaultTypeId: "ostatni",
  types: [
    { id: "rodinny_dum", name: "Rodinný dům", prefix: "RD", format: "{PREFIX}{SEQ:4}", jobTagMatch: "rodinn" },
    { id: "pergola", name: "Pergola", prefix: "PG", format: "{PREFIX}-{YEAR}-{SEQ:3}", jobTagMatch: "pergol" },
    { id: "zimni_zahrada", name: "Zimní zahrada", prefix: "ZZ", format: "{PREFIX}-{YEAR}-{SEQ:3}", jobTagMatch: "zimní" },
    { id: "rekreacni_dum", name: "Rekreační dům", prefix: "RE", format: "{PREFIX}-{YEAR}-{SEQ:3}", jobTagMatch: "rekrea" },
    { id: "dokumentace", name: "Dokumentace", prefix: "DOC", format: "{PREFIX}-{YEAR}-{SEQ:3}", jobTagMatch: "dokument" },
    { id: "montaz", name: "Montáž", prefix: "M", format: "{PREFIX}{SEQ:4}", jobTagMatch: "montá" },
    { id: "servis", name: "Servis", prefix: "SERV", format: "{PREFIX}{SEQ:4}", jobTagMatch: "servis" },
    { id: "ostatni", name: "Obecná zakázka", prefix: "ZAK", format: "{PREFIX}{SEQ:4}" },
  ],
};

export function formatPresetPrefixSeq(prefix: string, digits = 4): string {
  const d = Math.max(1, Math.min(8, digits));
  return `{PREFIX}{SEQ:${d}}`;
}

export function parseJobNumberingSettings(raw: unknown): JobNumberingSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_JOB_NUMBERING_SETTINGS;
  const o = raw as Record<string, unknown>;
  const typesRaw = Array.isArray(o.types) ? o.types : DEFAULT_JOB_NUMBERING_SETTINGS.types;
  const types: JobNumberingTypeRule[] = [];
  for (const t of typesRaw) {
    const row = t as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const prefix = String(row.prefix ?? "").trim();
    if (!id || !prefix) continue;
    const rule: JobNumberingTypeRule = {
      id,
      name: String(row.name ?? id).trim(),
      prefix,
      format: String(row.format ?? "{PREFIX}-{YEAR}-{SEQ:3}").trim(),
      startSequence:
        row.startSequence != null && Number.isFinite(Number(row.startSequence))
          ? Math.max(1, Math.floor(Number(row.startSequence)))
          : 1,
    };
    if (row.jobTagMatch != null && String(row.jobTagMatch).trim()) {
      rule.jobTagMatch = String(row.jobTagMatch).trim();
    }
    if (row.active === false) rule.active = false;
    types.push(rule);
  }
  const defaultTypeId =
    String(o.defaultTypeId ?? DEFAULT_JOB_NUMBERING_SETTINGS.defaultTypeId).trim() ||
    DEFAULT_JOB_NUMBERING_SETTINGS.defaultTypeId;
  return {
    resetYearly: o.resetYearly !== false,
    types: types.length ? types : DEFAULT_JOB_NUMBERING_SETTINGS.types,
    defaultTypeId,
  };
}

export function resolveNumberingTypeForJobTag(
  settings: JobNumberingSettings,
  jobTag: string | null | undefined
): JobNumberingTypeRule {
  const activeTypes = settings.types.filter((t) => t.active !== false);
  const pool = activeTypes.length ? activeTypes : settings.types;
  const tag = String(jobTag ?? "").trim().toLowerCase();
  if (tag) {
    for (const rule of pool) {
      const m = String(rule.jobTagMatch ?? "").trim().toLowerCase();
      if (m && (tag === m || tag.includes(m))) return rule;
    }
  }
  return (
    pool.find((t) => t.id === settings.defaultTypeId) ??
    pool[pool.length - 1]!
  );
}

export function resolveNumberingTypeById(
  settings: JobNumberingSettings,
  typeId: string | null | undefined
): JobNumberingTypeRule | null {
  const id = String(typeId ?? "").trim();
  if (!id) return null;
  return settings.types.find((t) => t.id === id) ?? null;
}

export function formatJobNumberFromParts(
  format: string,
  prefix: string,
  year: number,
  sequence: number
): string {
  const seqMatch = format.match(/\{SEQ:(\d+)\}/i);
  const width = seqMatch ? Math.max(1, parseInt(seqMatch[1]!, 10)) : 3;
  const seqStr = String(sequence).padStart(width, "0");
  return format
    .replace(/\{PREFIX\}/gi, prefix)
    .replace(/\{YEAR\}/gi, String(year))
    .replace(/\{SEQ:\d+\}/gi, seqStr)
    .replace(/\{SEQ\}/gi, seqStr);
}

export function previewNextJobNumber(
  settings: JobNumberingSettings,
  typeRule: JobNumberingTypeRule,
  nextSequence: number,
  year: number
): string {
  return formatJobNumberFromParts(typeRule.format, typeRule.prefix, year, nextSequence);
}

export function jobNumberCounterDocId(
  settings: JobNumberingSettings,
  typeId: string,
  year: number
): string {
  if (settings.resetYearly) return `${typeId}_${year}`;
  return typeId;
}

export function resolveExistingJobNumber(job: Record<string, unknown>): string {
  const n = String(
    job.jobNumber ?? job.orderNumber ?? job.documentNumber ?? ""
  ).trim();
  return n;
}
