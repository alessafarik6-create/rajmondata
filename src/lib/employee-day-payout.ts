/**
 * Denní označení výplaty (zaplaceno / poznámka) — dokument ve Firestore.
 * Klíč v mapě: `${employeeId}|${yyyy-MM-dd}`.
 */

export const MAX_EMPLOYEE_DAY_PAYOUT_NOTE_LEN = 400;

export const PAYROLL_ADJUSTMENT_REASONS = [
  { code: "forgotten_checkout", label: "Zapomenutý odchod" },
  { code: "off_terminal_work", label: "Práce mimo terminál" },
  { code: "business_trip", label: "Služební cesta" },
  { code: "attendance_fix", label: "Oprava docházky" },
  { code: "unpaid_break", label: "Neplacená přestávka" },
  { code: "other", label: "Jiné" },
] as const;

export type PayrollAdjustmentReasonCode =
  (typeof PAYROLL_ADJUSTMENT_REASONS)[number]["code"];

export type EmployeeDayPayoutAdjustmentAudit = {
  at: string;
  byUid: string;
  byName: string | null;
  previousMinutes: number;
  newMinutes: number;
  reasonCode: string;
  note: string | null;
};

export type EmployeeDayPayoutState = {
  paid: boolean;
  paidNote: string | null;
  /** Admin hromadně / ručně schválil den pro výplatu (employee_day_payouts). */
  approved?: boolean;
  /** Ruční korekce započteného času (minuty, může být záporné). */
  adjustmentMinutes?: number;
  adjustmentReasonCode?: string | null;
  adjustmentNote?: string | null;
  adjustmentUpdatedAt?: string | null;
  adjustmentUpdatedByName?: string | null;
  adjustmentAudit?: EmployeeDayPayoutAdjustmentAudit[];
};

export function employeeDayPayoutDocId(
  employeeId: string,
  dateIso: string
): string {
  const safe = employeeId.replace(/[/\\]/g, "_");
  return `${safe}_${dateIso}`;
}

export function buildGlobalDayPayoutMap(
  docs: Record<string, unknown>[],
  dateFromInclusive?: string,
  dateToInclusive?: string
): Map<string, EmployeeDayPayoutState> {
  const m = new Map<string, EmployeeDayPayoutState>();
  for (const d of docs) {
    const eid = String(d?.employeeId ?? "").trim();
    const date = String(d?.date ?? "").slice(0, 10);
    if (!eid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (dateFromInclusive && date < dateFromInclusive) continue;
    if (dateToInclusive && date > dateToInclusive) continue;
    const noteRaw = d?.paidNote;
    const note =
      noteRaw != null && String(noteRaw).trim()
        ? String(noteRaw)
            .trim()
            .slice(0, MAX_EMPLOYEE_DAY_PAYOUT_NOTE_LEN)
        : null;
    const adjRaw = d?.adjustmentMinutes;
    const adjustmentMinutes =
      typeof adjRaw === "number" && Number.isFinite(adjRaw) ? Math.round(adjRaw) : 0;
    const auditRaw = d?.adjustmentAudit;
    const adjustmentAudit = Array.isArray(auditRaw)
      ? (auditRaw as EmployeeDayPayoutAdjustmentAudit[]).slice(-20)
      : undefined;

    m.set(`${eid}|${date}`, {
      paid: d?.paid === true,
      paidNote: note,
      approved: d?.approved === true,
      adjustmentMinutes: adjustmentMinutes !== 0 ? adjustmentMinutes : undefined,
      adjustmentReasonCode:
        typeof d?.adjustmentReasonCode === "string" ? d.adjustmentReasonCode : null,
      adjustmentNote:
        typeof d?.adjustmentNote === "string" && d.adjustmentNote.trim()
          ? String(d.adjustmentNote).trim().slice(0, 400)
          : null,
      adjustmentUpdatedAt:
        typeof d?.adjustmentUpdatedAt === "string" ? d.adjustmentUpdatedAt : null,
      adjustmentUpdatedByName:
        typeof d?.adjustmentUpdatedByName === "string" ? d.adjustmentUpdatedByName : null,
      adjustmentAudit,
    });
  }
  return m;
}

export function dayPayoutMapForEmployee(
  global: Map<string, EmployeeDayPayoutState> | undefined,
  employeeId: string
): Map<string, EmployeeDayPayoutState> | undefined {
  if (!global || global.size === 0) return undefined;
  const m = new Map<string, EmployeeDayPayoutState>();
  const prefix = `${employeeId}|`;
  for (const [k, v] of global) {
    if (k.startsWith(prefix)) m.set(k.slice(prefix.length), v);
  }
  return m.size ? m : undefined;
}

/**
 * Sloučí záznamy pod `employeeDocId` a případně pod Auth UID (priorita má id dokumentu zaměstnance).
 */
export function dayPayoutByDateResolved(
  global: Map<string, EmployeeDayPayoutState> | undefined,
  employeeDocId: string,
  authUid?: string | null
): Map<string, EmployeeDayPayoutState> | undefined {
  if (!global || global.size === 0) return undefined;
  const auth = authUid?.trim() || "";
  const byDate = new Map<string, { eid: string; v: EmployeeDayPayoutState }>();
  for (const [k, v] of global) {
    const pipe = k.indexOf("|");
    if (pipe < 0) continue;
    const eid = k.slice(0, pipe);
    const date = k.slice(pipe + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (eid !== employeeDocId && (!auth || eid !== auth)) continue;
    const prev = byDate.get(date);
    if (!prev) byDate.set(date, { eid, v });
    else if (eid === employeeDocId) byDate.set(date, { eid, v });
  }
  if (byDate.size === 0) return undefined;
  const m = new Map<string, EmployeeDayPayoutState>();
  for (const [date, { v }] of byDate) m.set(date, v);
  return m;
}
