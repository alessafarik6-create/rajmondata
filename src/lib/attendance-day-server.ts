import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  computeWorkedHoursFromDayEvents,
  isShiftOpenFromSorted,
  parseHourlyRate,
  type AttendanceEventLite,
} from "@/lib/attendance-shift-state";

function docTimeMs(d: QueryDocumentSnapshot): number {
  const data = d.data() as { timestamp?: { toMillis?: () => number } };
  const ts = data.timestamp;
  if (ts && typeof ts.toMillis === "function") return ts.toMillis();
  return 0;
}

/**
 * Načte dnešní záznamy docházky pro firmu a vrátí mapu employeeId → seřazené události.
 */
export async function loadTodayAttendanceEventsByEmployee(
  db: Firestore,
  companyId: string,
  dateIso: string
): Promise<Map<string, AttendanceEventLite[]>> {
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("attendance")
    .where("date", "==", dateIso)
    .get();

  const map = new Map<string, AttendanceEventLite[]>();

  for (const d of snap.docs) {
    const data = d.data() as { employeeId?: string; type?: string };
    const eid = typeof data.employeeId === "string" ? data.employeeId : "";
    if (!eid) continue;
    const type = String(data.type || "");
    const ms = docTimeMs(d);
    if (ms <= 0) continue;
    const list = map.get(eid) || [];
    list.push({ type, timestampMs: ms });
    map.set(eid, list);
  }

  for (const [eid, list] of map) {
    list.sort((a, b) => a.timestampMs - b.timestampMs);
    map.set(eid, list);
  }

  return map;
}

export function employeeDayStats(
  events: AttendanceEventLite[] | undefined,
  hourlyRate: number | null,
  nowMs: number
): {
  inWork: boolean;
  todayHoursWorked: number;
  todayEarningsEstimate: number;
} {
  const sorted = events ?? [];
  const inWork = isShiftOpenFromSorted(sorted);
  const todayHoursWorked = computeWorkedHoursFromDayEvents(sorted, nowMs);
  const rate = hourlyRate ?? 0;
  const todayEarningsEstimate =
    Math.round(todayHoursWorked * rate * 100) / 100;
  return { inWork, todayHoursWorked, todayEarningsEstimate };
}

export function readEmployeeHourlyRate(data: Record<string, unknown> | undefined): number | null {
  if (!data) return null;
  return parseHourlyRate(data.hourlyRate);
}
