/** Uložené segmentJobSplits bez zakázky (interní práce, tarif z terminálu). */
export const NO_JOB_SEGMENT_JOB_ID = "__no_job__";

/** Řádek výkazu zadaný ručně — není vázaný na dokument `work_segments`. */
export const DAILY_REPORT_ROW_SOURCE_MANUAL = "manual";

/** Řádek vázaný na úsek z terminálu (`work_segments`). */
export const DAILY_REPORT_ROW_SOURCE_TERMINAL = "terminal";

export function isNoJobSegmentJobId(jid: string | null | undefined): boolean {
  const j = String(jid ?? "").trim();
  return !j || j === NO_JOB_SEGMENT_JOB_ID;
}

/** Staré uložené výkazy — virtuální segmentId místo segmentType manual (zpětná kompatibilita). */
export function isLegacyVirtualManualSegmentId(id: string): boolean {
  return id === ["__", "manual_attendance", "__"].join("");
}
