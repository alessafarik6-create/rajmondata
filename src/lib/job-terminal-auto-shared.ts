/** Sdílené konstanty a čisté predikáty — bez firebase-admin (klient + server). */

export const JOB_TERMINAL_AUTO_APPROVAL_SOURCE = "job-terminal-auto";

export function isJobTerminalAutoApprovedSegmentData(
  data: Record<string, unknown> | undefined | null
): boolean {
  if (!data) return false;
  return (
    data.approvedAutomatically === true &&
    String(data.approvalSource ?? "") === JOB_TERMINAL_AUTO_APPROVAL_SOURCE
  );
}
