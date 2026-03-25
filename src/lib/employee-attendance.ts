/**
 * Agregace záznamů docházky (Firestore: type check_in / check_out / …) na úroveň dne.
 */

export type AttendanceRow = {
  id?: string;
  type?: string;
  date?: string;
  timestamp?: { toDate?: () => Date } | Date | null;
  employeeId?: string;
};

export type DayAttendanceSummary = {
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  hoursWorked: number | null;
  /** Např. „V práci“, „Odchod“, „Neúplná docházka“ */
  statusLabel: string;
};

function rowTime(row: AttendanceRow): Date | null {
  const ts = row.timestamp;
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof (ts as { toDate?: () => Date }).toDate === "function") {
    return (ts as { toDate: () => Date }).toDate();
  }
  return null;
}

function formatHm(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Seskupí záznamy podle `date` (YYYY-MM-DD) a dopočítá příchod/odchod/hodiny.
 */
export function summarizeAttendanceByDay(
  rows: AttendanceRow[],
  options?: { employeeId?: string; authUid?: string }
): DayAttendanceSummary[] {
  const { employeeId, authUid } = options || {};
  const filtered = rows.filter((r) => {
    if (!employeeId && !authUid) return true;
    const eid = r.employeeId;
    return eid === employeeId || eid === authUid;
  });

  const byDate = new Map<string, AttendanceRow[]>();
  for (const r of filtered) {
    const t = rowTime(r);
    const dateKey =
      (r.date && String(r.date).trim()) ||
      (t ? t.toISOString().split("T")[0] : "");
    if (!dateKey) continue;
    const list = byDate.get(dateKey) || [];
    list.push(r);
    byDate.set(dateKey, list);
  }

  const summaries: DayAttendanceSummary[] = [];

  for (const [date, dayRows] of byDate) {
    const sorted = [...dayRows].sort((a, b) => {
      const ta = rowTime(a)?.getTime() ?? 0;
      const tb = rowTime(b)?.getTime() ?? 0;
      return ta - tb;
    });

    let checkIn: Date | null = null;
    let checkOut: Date | null = null;
    let lastType: string | null = null;

    for (const r of sorted) {
      const t = rowTime(r);
      if (!t) continue;
      const type = String(r.type || "");
      if (type === "check_in") {
        checkIn = t;
        lastType = type;
      } else if (type === "check_out") {
        checkOut = t;
        lastType = type;
      }
    }

    let hoursWorked: number | null = null;
    if (checkIn && checkOut && checkOut > checkIn) {
      hoursWorked =
        Math.round(((checkOut.getTime() - checkIn.getTime()) / 36e5) * 100) /
        100;
    }

    let statusLabel = "—";
    if (checkIn && checkOut) {
      statusLabel = "Kompletní den";
    } else if (checkIn && !checkOut) {
      statusLabel =
        lastType === "check_in" ? "V práci / bez odchodu" : "Neúplná docházka";
    } else if (!checkIn && checkOut) {
      statusLabel = "Chybí příchod";
    }

    summaries.push({
      date,
      checkIn: checkIn ? formatHm(checkIn) : null,
      checkOut: checkOut ? formatHm(checkOut) : null,
      hoursWorked,
      statusLabel,
    });
  }

  summaries.sort((a, b) => b.date.localeCompare(a.date));
  return summaries;
}

/**
 * Stav docházky za jeden den z nesetříděných řádků (např. všechny záznamy dnes pro jednoho zaměstnance).
 * „V práci“ = poslední relevantní událost je `check_in` novější než poslední `check_out`.
 */
export function inferAttendanceClockStateForDay(
  rows: AttendanceRow[]
): { state: "in"; lastCheckIn: Date } | { state: "out" } {
  const sorted = [...rows].sort((a, b) => {
    const ta = rowTime(a)?.getTime() ?? 0;
    const tb = rowTime(b)?.getTime() ?? 0;
    return ta - tb;
  });
  let lastInTime: Date | null = null;
  let lastOutTime: Date | null = null;
  for (const r of sorted) {
    const t = rowTime(r);
    if (!t) continue;
    const type = String(r.type || "");
    if (type !== "check_in" && type !== "check_out") continue;
    if (type === "check_in") lastInTime = t;
    if (type === "check_out") lastOutTime = t;
  }
  if (
    lastInTime &&
    (!lastOutTime || lastInTime.getTime() > lastOutTime.getTime())
  ) {
    return { state: "in", lastCheckIn: lastInTime };
  }
  return { state: "out" };
}

export function sumHoursTodayAndWeek(
  summaries: DayAttendanceSummary[],
  now = new Date()
): { today: number; week: number } {
  const todayIso = now.toISOString().split("T")[0];
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  startOfWeek.setDate(startOfWeek.getDate() + diff);
  startOfWeek.setHours(0, 0, 0, 0);
  const startIso = startOfWeek.toISOString().split("T")[0];

  let today = 0;
  let week = 0;
  for (const s of summaries) {
    const h = s.hoursWorked ?? 0;
    if (s.date === todayIso) today += h;
    if (s.date >= startIso && s.date <= todayIso) week += h;
  }
  return {
    today: Math.round(today * 100) / 100,
    week: Math.round(week * 100) / 100,
  };
}
