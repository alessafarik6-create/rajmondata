/** Uložené segmentJobSplits bez zakázky (interní práce, tarif z terminálu). */
export const NO_JOB_SEGMENT_JOB_ID = "__no_job__";

export function isNoJobSegmentJobId(jid: string | null | undefined): boolean {
  const j = String(jid ?? "").trim();
  return !j || j === NO_JOB_SEGMENT_JOB_ID;
}
