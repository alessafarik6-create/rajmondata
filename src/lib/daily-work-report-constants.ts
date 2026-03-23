/** Uložené segmentJobSplits bez zakázky (interní práce, tarif z terminálu). */
export const NO_JOB_SEGMENT_JOB_ID = "__no_job__";

/**
 * Virtuální úsek — výkaz jen z odpracovaných hodin v docházce, bez uzavřených úseků z terminálu.
 * Dokument ve work_segments s tímto ID neexistuje; server a odhad mzdy s ním počítají jako s „ne-tarifním“ řádkem.
 */
export const MANUAL_ATTENDANCE_SEGMENT_ID = "__manual_attendance__";

export function isNoJobSegmentJobId(jid: string | null | undefined): boolean {
  const j = String(jid ?? "").trim();
  return !j || j === NO_JOB_SEGMENT_JOB_ID;
}
