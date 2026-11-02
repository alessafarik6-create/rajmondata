import {
  buildWorkStatementIntervalRows,
  computeWorkStatementHoursBySource,
  detectWorkStatementAnomalies,
  type ProductionIntervalInput,
} from "./employee-work-statement";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Docházka 8 h, QR 3+5 h — uznáno 8 h, ne 16. */
const day = "2026-10-28";
const entries: ProductionIntervalInput[] = [
  {
    id: "a",
    companyId: "c1",
    employeeId: "e1",
    jobId: "j1",
    jobNumber: "RD0001",
    jobName: "Dům",
    productionTaskId: "t1",
    taskName: "Opláštění",
    startedAtIso: "2026-10-28T12:47:00.000Z",
    endedAtIso: "2026-10-28T16:00:00.000Z",
    durationSeconds: 3 * 3600 + 13 * 60,
    source: "qr",
    workDateIso: day,
  },
  {
    id: "b",
    companyId: "c1",
    employeeId: "e1",
    jobId: "j2",
    jobNumber: "M0001",
    jobName: "Montáž",
    productionTaskId: "t2",
    taskName: "Montáž",
    startedAtIso: "2026-10-28T07:00:00.000Z",
    endedAtIso: "2026-10-28T12:00:00.000Z",
    durationSeconds: 5 * 3600,
    source: "qr",
    workDateIso: day,
  },
];

const rows = buildWorkStatementIntervalRows({
  entries,
  fromIso: day,
  toIso: day,
  hourlyRateCzk: 200,
  includeMoney: true,
});

assert(rows.length === 2, "two rows");

const att = new Map([
  [day, { dayIso: day, hoursWorked: 8, breakMinutes: 30 }],
]);
const rep = new Map<string, { dayIso: string; status: string }>();
const hours = computeWorkStatementHoursBySource({
  intervalRows: rows,
  attendanceByDay: att,
  dailyReportsByDay: rep,
  terminalHoursByDay: new Map(),
  fromIso: day,
  toIso: day,
});

assert(hours.recognizedPayableHours === 8, "payable is attendance 8h");
assert(Math.round(hours.qrJobHours * 10) / 10 === 8.2, "qr sum ~8.2h");
assert(hours.unassignedToJobHours >= 0, "unassigned non-negative");

const anomalies = detectWorkStatementAnomalies({
  intervalRows: rows,
  attendanceByDay: att,
  dailyReportsByDay: rep,
});
assert(
  !anomalies.some((a) => a.code === "qr_without_attendance"),
  "no qr without attendance when 8h present"
);

console.log("ok employee-work-statement");
