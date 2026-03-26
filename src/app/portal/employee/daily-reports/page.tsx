"use client";

import React, { useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, min, max } from "date-fns";
import { cs } from "date-fns/locale";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { doc, collection, query, where, limit } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, AlertCircle, Plus, Trash2, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { summarizeAttendanceByDay } from "@/lib/employee-attendance";
import { useEmployeeUiLang } from "@/hooks/use-employee-ui-lang";
import { useAssignedWorklogJobs } from "@/hooks/use-assigned-worklog-jobs";
import { cn } from "@/lib/utils";
import { formatKc } from "@/lib/employee-money";
import { isDailyWorkLogEnabled } from "@/lib/employee-report-flags";
import {
  type WorkSegmentClient,
  buildWorkDayId,
  closedTerminalSegmentsForDay,
  getTerminalSegmentLockKind,
  segmentDateIsoKey,
  segmentTimeRangeLabel,
  sortSegmentsByStart,
} from "@/lib/work-segment-client";
import {
  type DayFormRow,
  buildAttendanceOnlySplits,
  buildFullSegmentJobSplits,
  effectiveLockedUnlocked,
  mergeAttendanceOnlyRowsFromReport,
  mergeUnlockedRowsFromReport,
  segmentDurationHours,
  sumClosedSegmentHours,
} from "@/lib/daily-work-report-day-form";
import { isJobTerminalAutoApprovedSegmentData } from "@/lib/job-terminal-auto-shared";
import { isDailyReportLockedBy24hRule } from "@/lib/daily-report-24h-lock";
import { buildDayCalendarMarkerMap } from "@/lib/daily-report-calendar-state";

/** Tolerance pro srovnání součtu řádků s interním stropem (bez falešných překročení kvůli float). */
const SUM_COMPARE_EPS = 1e-6;
/** Rozdíl docházka vs. úseky terminálu — hrubější tolerance (minuty). */
const ATTENDANCE_SEG_EPS = 0.02;
/** Zobrazení hodin (2 des. místa). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type AssignedJobOption = { id: string; name?: string };

function newSplitRowId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseHoursInput(str: string): number | null {
  const t = String(str ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Popis pro API / Firestore — z řádků (popis práce nebo název zakázky), bez duplicitního pole „Co jste dělali“. */
function buildDescriptionFromDayRows(
  rows: DayFormRow[],
  assignedJobs: AssignedJobOption[]
): string {
  const lines: string[] = [];
  for (const r of rows) {
    const h = parseHoursInput(r.hoursStr);
    if (h == null || h <= 0) continue;
    const note = String(r.lineNote ?? "").trim();
    if (note) {
      lines.push(note);
      continue;
    }
    const jid = String(r.jobId ?? "").trim();
    if (jid) {
      const j = assignedJobs.find((x) => x.id === jid);
      lines.push(j?.name ? `Zakázka: ${j.name}` : `Zakázka (${jid})`);
    }
  }
  return lines.join("\n\n").trim();
}

function buildDescriptionForDailyReportSubmit(
  rows: DayFormRow[],
  assignedJobs: AssignedJobOption[],
  jobTerminalLineNotes: Record<string, string>,
  closedSegments: WorkSegmentClient[]
): string {
  let d = buildDescriptionFromDayRows(rows, assignedJobs);
  if (d.trim()) return d;
  const notes = Object.values(jobTerminalLineNotes)
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
  if (notes.length) return notes.join("\n\n");
  if (
    closedSegments.some((s) =>
      isJobTerminalAutoApprovedSegmentData(s as unknown as Record<string, unknown>)
    )
  ) {
    return "Práce na zakázce (terminál, automaticky schválený výdělek).";
  }
  return "";
}

function sumDayFormHours(rows: DayFormRow[]): number {
  let s = 0;
  for (const r of rows) {
    const h = parseHoursInput(r.hoursStr);
    if (h != null && h > 0) s += h;
  }
  return Math.round(s * 100) / 100;
}

function validateDayForm(
  closedSegments: WorkSegmentClient[],
  dayFormRows: DayFormRow[],
  mode: "draft" | "submit",
  assignedJobIds: string[],
  dayWorkedCap: number,
  lockedSum: number
): string | null {
  if (dayWorkedCap <= SUM_COMPARE_EPS) {
    return "Pro tento den není žádný odpracovaný čas — výkaz nelze uložit.";
  }

  const attendanceOnly = closedSegments.length === 0;
  const assigned = new Set(assignedJobIds);

  if (attendanceOnly) {
    const formCap = dayWorkedCap;
    for (const r of dayFormRows) {
      const h = parseHoursInput(r.hoursStr);
      const jid = String(r.jobId || "").trim();
      if (h != null && h > 0 && jid && !assigned.has(jid)) {
        return "Vyberte jen zakázku z vašeho přiřazení.";
      }
    }
    for (const r of dayFormRows) {
      const h = parseHoursInput(r.hoursStr);
      const jid = String(r.jobId || "").trim();
      const note = String(r.lineNote || "").trim();
      const hasAny = String(r.hoursStr || "").trim() || jid || note;
      if (mode === "submit" && hasAny && (h == null || h <= 0)) {
        return "U každého vyplněného řádku zadejte kladný počet hodin (bez nuly).";
      }
      if (h != null && h > 0 && !jid && !note) {
        return "U každého řádku s hodinami vyberte zakázku nebo doplňte popis práce (např. interní úkol).";
      }
    }
    const sum = sumDayFormHours(dayFormRows);
    if (sum > formCap + SUM_COMPARE_EPS) {
      return `Součet hodin v řádcích (${sum} h) překračuje odpracovaný čas z docházky (${round2(formCap)} h).`;
    }
    if (mode === "submit" && sum < formCap - SUM_COMPARE_EPS) {
      return `Rozdělte celkem ${round2(formCap)} h (zbývá ${round2(formCap - sum)} h).`;
    }
    return null;
  }

  const { unlocked } = effectiveLockedUnlocked(closedSegments);
  const unlockedSum = sumClosedSegmentHours(unlocked);
  const availableHoursRaw = Math.max(0, dayWorkedCap - lockedSum);
  const formCap =
    unlocked.length === 0 ? 0 : Math.min(unlockedSum, availableHoursRaw);

  for (const r of dayFormRows) {
    const h = parseHoursInput(r.hoursStr);
    const jid = String(r.jobId || "").trim();
    if (h != null && h > 0 && jid && !assigned.has(jid)) {
      return "Vyberte jen zakázku z vašeho přiřazení.";
    }
  }

  if (unlocked.length > 0) {
    for (const r of dayFormRows) {
      const h = parseHoursInput(r.hoursStr);
      const jid = String(r.jobId || "").trim();
      const note = String(r.lineNote || "").trim();
      const hasAny =
        String(r.hoursStr || "").trim() || jid || note;
      if (mode === "submit" && hasAny && (h == null || h <= 0)) {
        return "U každého vyplněného řádku zadejte kladný počet hodin (bez nuly).";
      }
      if (h != null && h > 0 && !jid && !note) {
        return "U každého řádku s hodinami vyberte zakázku nebo doplňte popis práce (např. interní úkol).";
      }
    }
  }

  const sum = sumDayFormHours(dayFormRows);
  if (unlocked.length > 0) {
    if (sum > formCap + SUM_COMPARE_EPS) {
      return `Součet hodin v řádcích (${sum} h) překračuje dostupný čas pro výkaz (${round2(formCap)} h, bez tarifů a uzamčených zakázek z terminálu).`;
    }
    if (sum < formCap - SUM_COMPARE_EPS) {
      return `Rozdělte celkem ${round2(formCap)} h (zbývá ${round2(formCap - sum)} h).`;
    }
  }

  const rozděleno = lockedSum + sum;
  if (rozděleno > dayWorkedCap + SUM_COMPARE_EPS) {
    return `Součet hodin (${rozděleno} h) překračuje odpracovaný čas z docházky a terminálu (${dayWorkedCap} h).`;
  }

  try {
    buildFullSegmentJobSplits(closedSegments, dayFormRows, parseHoursInput);
  } catch (e) {
    return e instanceof Error ? e.message : "Neplatné rozdělení hodin vůči úsekům z terminálu.";
  }
  return null;
}

export default function EmployeeDailyReportsPage() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { companyName, company } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading, error: profileError } = useDoc<any>(userRef);
  const { t } = useEmployeeUiLang(profile);

  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;
  const role = (profile?.role as string | undefined) ?? "employee";
  const privileged = ["owner", "admin", "manager", "accountant"].includes(role);

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", employeeId)
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeDoc, isLoading: employeeRowLoading } = useDoc<any>(employeeRef);
  const { assignedJobIds, jobs: assignedJobs, jobsLoading } = useAssignedWorklogJobs(
    firestore,
    companyId,
    employeeDoc ?? undefined,
    employeeRowLoading,
    user?.uid,
    employeeId
  );

  const authUid = user?.uid;
  const needAltAttendanceKey =
    Boolean(authUid && employeeId) && authUid !== employeeId;

  const attendanceEmployeeQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "attendance"),
      where("employeeId", "==", employeeId),
      limit(500)
    );
  }, [firestore, companyId, employeeId]);

  const attendanceUidQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !needAltAttendanceKey || !authUid) return null;
    return query(
      collection(firestore, "companies", companyId, "attendance"),
      where("employeeId", "==", authUid),
      limit(500)
    );
  }, [firestore, companyId, needAltAttendanceKey, authUid]);

  const silentListen = { suppressGlobalPermissionError: true as const };

  const { data: attendanceByEmployee = [], isLoading: attendanceLoadEmp } = useCollection(
    attendanceEmployeeQuery,
    silentListen
  );
  const { data: attendanceByUid = [], isLoading: attendanceLoadUid } = useCollection(
    attendanceUidQuery,
    silentListen
  );

  const attendanceLoading = attendanceLoadEmp || (needAltAttendanceKey ? attendanceLoadUid : false);

  /** Sloučení záznamů pod employeeId a případně pod UID (legacy) — bez dotazu `in`, který vyžaduje index. */
  const attendanceBlocks = useMemo(() => {
    const a = (Array.isArray(attendanceByEmployee) ? attendanceByEmployee : []) as Record<
      string,
      unknown
    >[];
    const b = (Array.isArray(attendanceByUid) ? attendanceByUid : []) as Record<string, unknown>[];
    const map = new Map<string, Record<string, unknown>>();
    for (const row of [...a, ...b]) {
      const id = String((row as { id?: string }).id ?? "");
      if (id && !map.has(id)) map.set(id, row);
    }
    return Array.from(map.values());
  }, [attendanceByEmployee, attendanceByUid]);

  const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date());
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());

  const dailyReportsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "daily_work_reports"),
      where("employeeId", "==", employeeId),
      limit(500)
    );
  }, [firestore, companyId, employeeId]);

  const { data: monthlyDailyReportsRaw = [] } = useCollection(dailyReportsQuery);

  /**
   * Rozsah workDayId = employeeId__YYYY-MM-DD — jedno pole, bez složeného indexu s employeeId+date.
   * Pokrývá měsíc kalendáře i měsíc vybraného dne (mohou se lišit při listování).
   */
  const workSegmentsRangeQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId || !calendarMonth || !selectedDay) return null;
    const rangeStart = min([startOfMonth(calendarMonth), startOfMonth(selectedDay)]);
    const rangeEnd = max([endOfMonth(calendarMonth), endOfMonth(selectedDay)]);
    const dMin = format(rangeStart, "yyyy-MM-dd");
    const dMax = format(rangeEnd, "yyyy-MM-dd");
    const minId = buildWorkDayId(employeeId, dMin);
    const maxId = buildWorkDayId(employeeId, dMax);
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("workDayId", ">=", minId),
      where("workDayId", "<=", maxId),
      limit(5000)
    );
  }, [firestore, companyId, employeeId, calendarMonth, selectedDay]);

  const {
    data: workSegmentsAllData,
    isLoading: segmentsLoading,
    error: segmentsQueryError,
  } = useCollection<WorkSegmentClient>(workSegmentsRangeQuery);

  /**
   * Záložní dotaz jen pro vybraný den: employeeId + date (index v projektu).
   * Doplní segmenty bez pole workDayId nebo když rozsah workDayId selže.
   */
  const workSegmentsDayAltQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId || !selectedDay) return null;
    const dk = format(selectedDay, "yyyy-MM-dd");
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("employeeId", "==", employeeId),
      where("date", "==", dk),
      limit(300)
    );
  }, [firestore, companyId, employeeId, selectedDay]);

  const {
    data: workSegmentsDayAltData,
    isLoading: segmentsDayAltLoading,
    error: segmentsDayAltError,
  } = useCollection<WorkSegmentClient>(workSegmentsDayAltQuery);

  const workSegmentsAll = useMemo(() => {
    if (workSegmentsAllData == null) return [] as WorkSegmentClient[];
    const raw = Array.isArray(workSegmentsAllData) ? workSegmentsAllData : [];
    if (!employeeId) return raw;
    return raw.filter(
      (s) =>
        !s.employeeId ||
        s.employeeId === employeeId ||
        (user?.uid && s.employeeId === user.uid)
    );
  }, [workSegmentsAllData, employeeId, user?.uid]);

  const reportsByDate = useMemo(() => {
    const raw = Array.isArray(monthlyDailyReportsRaw) ? monthlyDailyReportsRaw : [];
    const m = new Map<string, Record<string, unknown>>();
    for (const r of raw) {
      const row = r as Record<string, unknown>;
      const dk = String(row.date ?? "").trim();
      if (dk) m.set(dk, row);
    }
    return m;
  }, [monthlyDailyReportsRaw]);

  const workSegmentsMonthRaw = useMemo(() => {
    const ms = format(startOfMonth(calendarMonth), "yyyy-MM-dd");
    const me = format(endOfMonth(calendarMonth), "yyyy-MM-dd");
    return workSegmentsAll.filter((s) => {
      const d = segmentDateIsoKey(s);
      return d.length >= 10 && d >= ms && d <= me;
    });
  }, [workSegmentsAll, calendarMonth]);

  const segmentsByDate = useMemo(() => {
    const raw = workSegmentsMonthRaw;
    const m = new Map<string, WorkSegmentClient[]>();
    for (const s of raw) {
      const row = s as WorkSegmentClient;
      const dk = segmentDateIsoKey(row);
      if (!dk) continue;
      const arr = m.get(dk) ?? [];
      arr.push({ ...row, id: String(row.id ?? "") } as WorkSegmentClient);
      m.set(dk, arr);
    }
    return m;
  }, [workSegmentsMonthRaw]);

  const lock24hEnabled = company?.enableDailyReport24hLock === true;

  const markerMap = useMemo(
    () =>
      buildDayCalendarMarkerMap(calendarMonth, {
        attendanceBlocks,
        employeeId,
        authUid: user?.uid,
        segmentsByDate,
        reportsByDate,
        lock24hEnabled,
        now: new Date(),
      }),
    [
      calendarMonth,
      attendanceBlocks,
      employeeId,
      user?.uid,
      segmentsByDate,
      reportsByDate,
      lock24hEnabled,
      selectedDay,
    ]
  );

  const calendarModifiers = useMemo(() => {
    const mk =
      (pred: (st: string) => boolean) =>
      (d: Date) => {
        const key = format(d, "yyyy-MM-dd");
        const st = markerMap.get(key);
        return st != null && pred(st);
      };
    return {
      calNoShift: mk((s) => s === "no_shift"),
      calWorkNoReport: mk((s) => s === "work_no_report"),
      calDraft: mk((s) => s === "draft"),
      calPending: mk((s) => s === "pending"),
      calApproved: mk((s) => s === "approved"),
      calReturned: mk((s) => s === "returned"),
      calRejected: mk((s) => s === "rejected"),
      calLocked: mk((s) => s === "locked_timeout"),
    };
  }, [markerMap]);

  const calendarModifiersClassNames = {
    calNoShift:
      "border border-neutral-400 bg-neutral-100 text-neutral-900 hover:bg-neutral-100 rounded-md",
    calWorkNoReport:
      "border-2 border-amber-600 bg-amber-100 text-amber-950 hover:bg-amber-100 rounded-md",
    calDraft:
      "border-2 border-orange-600 bg-orange-100 text-neutral-950 hover:bg-orange-100 rounded-md",
    calPending:
      "border-2 border-amber-800 bg-amber-200 text-neutral-950 hover:bg-amber-200 rounded-md",
    calApproved:
      "border-2 border-emerald-700 bg-emerald-100 text-emerald-950 hover:bg-emerald-100 rounded-md",
    calReturned:
      "border-2 border-violet-700 bg-violet-100 text-violet-950 hover:bg-violet-100 rounded-md",
    calRejected:
      "border-2 border-red-700 bg-red-100 text-red-950 hover:bg-red-100 rounded-md",
    calLocked:
      "border-2 border-neutral-950 bg-slate-200 text-neutral-950 hover:bg-slate-200 rounded-md ring-2 ring-neutral-950/30",
  };

  const dayKey = selectedDay ? format(selectedDay, "yyyy-MM-dd") : "";
  const selectedDayMarker = dayKey ? markerMap.get(dayKey) : undefined;

  /** Sloučení rozsahu workDayId + záložního dotazu employeeId+date pro stejný den. */
  const workSegmentsForDay = useMemo(() => {
    if (!dayKey) return [] as WorkSegmentClient[];
    const fromRange = workSegmentsAll.filter((s) => segmentDateIsoKey(s) === dayKey);
    const alt = Array.isArray(workSegmentsDayAltData) ? workSegmentsDayAltData : [];
    const byId = new Map<string, WorkSegmentClient>();
    for (const s of fromRange) {
      const id = String(s.id ?? "");
      byId.set(id, { ...s, id });
    }
    for (const s of alt) {
      const id = String(s.id ?? "");
      if (!byId.has(id)) {
        byId.set(id, { ...s, id });
      }
    }
    return [...byId.values()];
  }, [workSegmentsAll, workSegmentsDayAltData, dayKey]);

  const reportRef = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId || !dayKey) return null;
    return doc(
      firestore,
      "companies",
      companyId,
      "daily_work_reports",
      `${employeeId}__${dayKey}`
    );
  }, [firestore, companyId, employeeId, dayKey]);

  const { data: existingReport, isLoading: reportLoading } = useDoc<any>(reportRef);

  const closedSegments = useMemo(() => {
    const withId = workSegmentsForDay.map((s) => ({
      ...s,
      id: String(s.id ?? ""),
    })) as WorkSegmentClient[];
    return sortSegmentsByStart(closedTerminalSegmentsForDay(withId, dayKey));
  }, [workSegmentsForDay, dayKey]);

  const closedSegmentIdsKey = useMemo(
    () => closedSegments.map((s: WorkSegmentClient) => s.id).join("|"),
    [closedSegments]
  );

  const daySummary = useMemo(() => {
    const summaries = summarizeAttendanceByDay(attendanceBlocks as any[], {
      employeeId,
      authUid: user?.uid,
    });
    return summaries.find((s) => s.date === dayKey) ?? null;
  }, [attendanceBlocks, dayKey, employeeId, user?.uid]);

  const [note, setNote] = useState("");
  /** Jeden hlavní formulář pro odemčené úseky (čas → zakázky / popis v pořadí úseků). */
  const [dayFormRows, setDayFormRows] = useState<DayFormRow[]>(() => [
    {
      rowId: "init-row",
      jobId: "",
      hoursStr: "",
      lineNote: "",
    },
  ]);
  /** Volitelný popis u úseků se zakázkou z terminálu (tarify bez formuláře). */
  const [jobTerminalLineNotes, setJobTerminalLineNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existingReport) {
      setNote(String(existingReport.note ?? ""));
      return;
    }
    setNote("");
  }, [existingReport, dayKey]);

  const assignedJobIdsKey = useMemo(() => assignedJobIds.join("|"), [assignedJobIds]);

  const segmentsDayLoading = segmentsLoading || segmentsDayAltLoading;

  useEffect(() => {
    if (!dayKey) return;
    if (segmentsDayLoading) return;
    if (!closedSegments.length) {
      setJobTerminalLineNotes({});
      const att = daySummary?.hoursWorked ?? null;
      const dayCapInit =
        att != null && Number.isFinite(att) ? att : 0;
      let merged = mergeAttendanceOnlyRowsFromReport(existingReport ?? undefined);
      if (merged.length === 0 && dayCapInit > SUM_COMPARE_EPS) {
        merged = [
          {
            rowId: newSplitRowId(),
            jobId: "",
            hoursStr: String(dayCapInit).replace(".", ","),
            lineNote: "",
          },
        ];
      }
      if (merged.length === 0) {
        merged = [
          {
            rowId: newSplitRowId(),
            jobId: "",
            hoursStr: "",
            lineNote: "",
          },
        ];
      }
      setDayFormRows(merged);
      return;
    }
    const { locked, unlocked } = effectiveLockedUnlocked(closedSegments);
    const lockedSumInit = sumClosedSegmentHours(locked);
    const unlockedSumInit = sumClosedSegmentHours(unlocked);
    const segmentTotalInit = sumClosedSegmentHours(closedSegments);
    const att = daySummary?.hoursWorked ?? null;
    const dayCapInit =
      att != null && Number.isFinite(att) && segmentTotalInit > 0
        ? Math.min(att, segmentTotalInit)
        : att ?? segmentTotalInit;
    const availableInit = Math.max(0, dayCapInit - lockedSumInit);
    const formCapInit =
      unlocked.length === 0 ? 0 : Math.min(unlockedSumInit, availableInit);
    let merged = mergeUnlockedRowsFromReport(unlocked, existingReport);
    if (merged.length === 0 && formCapInit > SUM_COMPARE_EPS) {
      merged = [
        {
          rowId: newSplitRowId(),
          jobId: "",
          hoursStr: String(formCapInit).replace(".", ","),
          lineNote: "",
        },
      ];
    }
    if (merged.length === 0) {
      merged = [
        {
          rowId: newSplitRowId(),
          jobId: "",
          hoursStr: "",
          lineNote: "",
        },
      ];
    }
    setDayFormRows(merged);
    const sn = (existingReport?.segmentLineNotes as Record<string, string> | undefined) ?? {};
    const jobT: Record<string, string> = {};
    for (const s of locked) {
      const k = getTerminalSegmentLockKind(s);
      const note = sn[s.id] ?? "";
      if (k === "job_terminal") jobT[s.id] = note;
    }
    setJobTerminalLineNotes(jobT);
  }, [
    existingReport,
    dayKey,
    closedSegmentIdsKey,
    closedSegments,
    daySummary,
    segmentsDayLoading,
    assignedJobIdsKey,
    assignedJobIds.length,
  ]);

  const postReport = async (mode: "draft" | "submit") => {
    if (!user || !companyId || !dayKey) return;
    if (!isDailyWorkLogEnabled(employeeDoc)) {
      toast({
        variant: "destructive",
        title: "Funkce je vypnutá",
        description: "Administrátor vypnul denní výkaz práce pro váš účet.",
      });
      return;
    }
    if (privileged) {
      toast({
        variant: "destructive",
        title: "Nelze uložit",
        description: "Denní výkaz ukládají zaměstnanci — použijte účet s rolí zaměstnanec.",
      });
      return;
    }
    if (
      selectedDay &&
      isDailyReportLockedBy24hRule(selectedDay, {
        lockEnabled: lock24hEnabled,
        reportStatus: existingReport?.status as string | undefined,
      })
    ) {
      toast({
        variant: "destructive",
        title: "Uzamčeno",
        description: "Zápis je uzamčen po 24 hodinách.",
      });
      return;
    }
    const attPost = daySummary?.hoursWorked ?? null;
    const segTotPost = sumClosedSegmentHours(closedSegments);
    if (
      closedSegments.length > 0 &&
      attPost != null &&
      Number.isFinite(attPost) &&
      segTotPost > attPost + ATTENDANCE_SEG_EPS
    ) {
      toast({
        variant: "destructive",
        title: "Nelze uložit výkaz",
        description:
          "Součet času z terminálu je vyšší než odpracovaný čas z docházky. Vyřešte nesoulad u administrátora.",
      });
      return;
    }
    const { locked: lockedForCap } = effectiveLockedUnlocked(closedSegments);
    const lockedSumPost = sumClosedSegmentHours(lockedForCap);
    const segmentTotalPost = sumClosedSegmentHours(closedSegments);
    const att = daySummary?.hoursWorked ?? null;
    const dayWorkedCapPost =
      att != null && Number.isFinite(att) && segmentTotalPost > 0
        ? Math.min(att, segmentTotalPost)
        : att ?? segmentTotalPost;

    const splitErr = validateDayForm(
      closedSegments,
      dayFormRows,
      mode,
      assignedJobIds,
      dayWorkedCapPost,
      lockedSumPost
    );
    if (splitErr) {
      toast({ variant: "destructive", title: "Nelze uložit výkaz", description: splitErr });
      return;
    }
    const segmentJobSplitsBuilt =
      closedSegments.length === 0
        ? buildAttendanceOnlySplits(dayFormRows, parseHoursInput)
        : buildFullSegmentJobSplits(closedSegments, dayFormRows, parseHoursInput);
    if (segmentJobSplitsBuilt.length === 0) {
      toast({
        variant: "destructive",
        title: "Nelze uložit výkaz",
        description: "Vyplňte alespoň jeden řádek s kladnými hodinami.",
      });
      return;
    }
    const descriptionPayload = buildDescriptionForDailyReportSubmit(
      dayFormRows,
      assignedJobs,
      jobTerminalLineNotes,
      closedSegments
    );
    if (mode === "submit" && !descriptionPayload.trim()) {
      toast({
        variant: "destructive",
        title: "Chybí popis práce",
        description: "U řádků s hodinami doplňte popis práce nebo vyberte zakázku.",
      });
      return;
    }
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const segmentJobSplits = segmentJobSplitsBuilt.map((s) => {
        const h =
          typeof s.hours === "number" && Number.isFinite(s.hours)
            ? Math.round(s.hours * 100) / 100
            : (() => {
                const t = String(s.hours ?? "").trim().replace(",", ".");
                const n = Number(t);
                return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
              })();
        return {
          segmentId: String(s.segmentId),
          jobId: s.jobId != null && String(s.jobId).trim() !== "" ? String(s.jobId) : null,
          hours: h,
        };
      });
      const dayWorkLines = dayFormRows.map((r) => ({
        lineNote: String(r.lineNote ?? "").trim(),
      }));
      const segmentLineNotes = Object.fromEntries(
        Object.entries(jobTerminalLineNotes).map(([k, v]) => [k, String(v ?? "").trim()])
      );
      const payload = {
        companyId,
        date: dayKey,
        description: descriptionPayload,
        note: String(note ?? "").trim(),
        segmentJobSplits,
        dayWorkLines,
        segmentLineNotes,
        mode,
      };
      console.log("[daily-reports] POST /api/employee/daily-work-report", JSON.stringify(payload));
      const res = await fetch("/api/employee/daily-work-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: data.error || "Uložení se nezdařilo.",
        });
        return;
      }
      toast({
        title: t("saved"),
        description:
          mode === "draft"
            ? "Koncept byl uložen."
            : "Výkaz byl odeslán ke schválení. Částka se započte až po schválení.",
      });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Chyba", description: "Síťová chyba." });
    } finally {
      setSaving(false);
    }
  };

  const status = existingReport?.status as string | undefined;
  const formLocked = status === "approved" || status === "pending";
  const isLockedBy24h =
    selectedDay != null &&
    isDailyReportLockedBy24hRule(selectedDay, {
      lockEnabled: lock24hEnabled,
      reportStatus: status,
    });
  const effectiveFormLocked = formLocked || isLockedBy24h;
  const dailyWorkLogOff = !isDailyWorkLogEnabled(employeeDoc);

  const { locked: lockedFromTerminal, unlocked: unlockedSegments } = useMemo(
    () => effectiveLockedUnlocked(closedSegments),
    [closedSegments]
  );
  const tariffSegments = useMemo(
    () =>
      lockedFromTerminal.filter((s) => getTerminalSegmentLockKind(s) === "tariff_terminal"),
    [lockedFromTerminal]
  );
  const jobTerminalSegments = useMemo(
    () =>
      lockedFromTerminal.filter((s) => getTerminalSegmentLockKind(s) === "job_terminal"),
    [lockedFromTerminal]
  );
  const tariffSum = useMemo(() => sumClosedSegmentHours(tariffSegments), [tariffSegments]);
  const jobTerminalSumOnly = useMemo(
    () => sumClosedSegmentHours(jobTerminalSegments),
    [jobTerminalSegments]
  );
  const segmentTotal = useMemo(() => sumClosedSegmentHours(closedSegments), [closedSegments]);
  const lockedSum = useMemo(() => sumClosedSegmentHours(lockedFromTerminal), [lockedFromTerminal]);
  const unlockedSum = useMemo(() => sumClosedSegmentHours(unlockedSegments), [unlockedSegments]);
  const attendanceHours = daySummary?.hoursWorked ?? null;
  /** Horní strop hodin pro výkaz: min(docházka, součet úseků terminálu), jinak co je k dispozici. */
  const dayWorkedCap = useMemo(() => {
    if (attendanceHours != null && Number.isFinite(attendanceHours) && segmentTotal > 0) {
      return Math.min(attendanceHours, segmentTotal);
    }
    if (attendanceHours != null && Number.isFinite(attendanceHours)) return attendanceHours;
    return segmentTotal;
  }, [attendanceHours, segmentTotal]);
  /** Úseky z terminálu přesahují odpracovaný čas z docházky — výkaz nelze spolehlivě srovnat. */
  const dataAttendanceTooLow =
    attendanceHours != null &&
    Number.isFinite(attendanceHours) &&
    segmentTotal > attendanceHours + ATTENDANCE_SEG_EPS;
  /** Odpracováno − tarif − zakázka z terminálu (stejné jako dostupný čas pro ruční řádky). */
  const availableHoursRaw = useMemo(
    () => Math.max(0, dayWorkedCap - lockedSum),
    [dayWorkedCap, lockedSum]
  );
  const dostupnýProŘádkyZobrazení = round2(availableHoursRaw);
  /** Strop hodin v hlavním formuláři — bez terminálu = celá odpracovaná docházka; s terminálem = min(odemčené úseky, dostupný čas). */
  const formHoursCap = useMemo(() => {
    if (closedSegments.length === 0) {
      return Math.max(0, dayWorkedCap);
    }
    if (unlockedSegments.length === 0) return 0;
    return Math.min(unlockedSum, availableHoursRaw);
  }, [
    closedSegments.length,
    unlockedSegments.length,
    unlockedSum,
    availableHoursRaw,
    dayWorkedCap,
  ]);
  /** Jediná podmínka pro úpravu řádků: odpracovaný čas > 0 (úseky z terminálu nejsou povinné). */
  const formEditableByAttendance = dayWorkedCap > SUM_COMPARE_EPS && !dailyWorkLogOff;
  const hoursDisabled = effectiveFormLocked || !formEditableByAttendance;
  const jobSelectDisabled = effectiveFormLocked || !formEditableByAttendance;
  const segmentsFetchFailed =
    !segmentsDayLoading &&
    Boolean(segmentsQueryError) &&
    Boolean(segmentsDayAltError) &&
    closedSegments.length === 0;
  const allocatedUnlocked = sumDayFormHours(dayFormRows);
  const rozdělenoCelkem = Math.round((lockedSum + allocatedUnlocked) * 100) / 100;
  const zbýváCap = Math.round((dayWorkedCap - rozdělenoCelkem) * 100) / 100;
  const zbýváVeFormuláři = Math.round((formHoursCap - allocatedUnlocked) * 100) / 100;
  const overCap = rozdělenoCelkem > dayWorkedCap + SUM_COMPARE_EPS;
  const overUnlocked = allocatedUnlocked > formHoursCap + SUM_COMPARE_EPS;
  const capMismatch =
    attendanceHours != null &&
    Number.isFinite(attendanceHours) &&
    Math.abs(attendanceHours - segmentTotal) > ATTENDANCE_SEG_EPS &&
    !dataAttendanceTooLow;
  const noTimeLeftToSplit = availableHoursRaw <= SUM_COMPARE_EPS;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log({
      workedHours: dayWorkedCap,
      segmentsCount: closedSegments.length,
      canEdit: formEditableByAttendance && !effectiveFormLocked,
    });
  }, [dayKey, dayWorkedCap, closedSegments.length, formEditableByAttendance, effectiveFormLocked]);

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">{t("loadingAuth")}</p>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">{t("loadingProfile")}</p>
      </div>
    );
  }

  if (!profile || profileError) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Profil</AlertTitle>
        <AlertDescription>{profileError?.message || "Profil nebyl nalezen."}</AlertDescription>
      </Alert>
    );
  }

  if (!companyId || !employeeId) {
    return (
      <Alert className="max-w-lg border-amber-200 bg-amber-50 text-amber-950">
        <AlertCircle className="h-4 w-4 text-amber-700" />
        <AlertTitle>Chybí data</AlertTitle>
        <AlertDescription>
          Pro denní výkaz musíte mít přiřazenou firmu a záznam zaměstnance (employeeId).
        </AlertDescription>
      </Alert>
    );
  }

  const cardBox =
    "border-2 border-neutral-950 bg-white text-neutral-950 shadow-sm";
  const cardTitle = "text-lg font-semibold text-neutral-950";
  const cardDesc = "text-sm text-neutral-900";

  return (
    <div className="mx-auto max-w-5xl space-y-6 sm:space-y-8 px-2 sm:px-0">
      <div className="rounded-xl border-2 border-neutral-950 bg-white p-4 sm:p-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">
          Výkaz práce
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-900 sm:text-base">
          Jeden denní zápis: docházka z terminálu, tarify a rozdělení zbývajícího času do řádků (hodiny, popis,
          volitelná zakázka). {companyName ? <span className="font-semibold">{companyName}</span> : null}
        </p>
      </div>

      {privileged ? (
        <Alert>
          <AlertTitle>Účet vedení</AlertTitle>
          <AlertDescription>
            Denní výkaz vyplňují zaměstnanci. Jste přihlášeni jako {role} — uložení je vypnuto.
            Schvalování je v <strong>Docházka → Schvalování výkazů</strong>.
          </AlertDescription>
        </Alert>
      ) : null}

      {dailyWorkLogOff && !privileged ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Denní výkaz práce je vypnutý</AlertTitle>
          <AlertDescription>
            Administrátor vypnul tuto funkci pro váš účet. Kontaktujte vedení firmy, pokud jde o omyl.
          </AlertDescription>
        </Alert>
      ) : null}

      {segmentsFetchFailed ? (
        <Alert variant="destructive" className="border-2 border-neutral-950">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Úseky z terminálu se nenačetly</AlertTitle>
          <AlertDescription className="text-neutral-900">
            Obě dotazy na úseky práce selhaly — zkuste obnovit stránku. Kontaktujte administrátora (index
            Firestore nebo oprávnění).
            {process.env.NODE_ENV === "development" && segmentsQueryError?.message ? (
              <span className="mt-2 block font-mono text-xs">
                {segmentsQueryError.message} / {segmentsDayAltError?.message ?? ""}
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {!segmentsDayLoading &&
      closedSegments.length === 0 &&
      (segmentsQueryError || segmentsDayAltError) &&
      !segmentsFetchFailed ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <AlertCircle className="h-4 w-4 text-amber-700" />
          <AlertTitle>Část dat o úsecích se načetla záložní cestou</AlertTitle>
          <AlertDescription>
            Jedna z dotazů na úseky selhala, druhá vrátila data. Pokud něco chybí, zkuste obnovit stránku.
          </AlertDescription>
        </Alert>
      ) : null}

      {isLockedBy24h && !formLocked ? (
        <Alert className="border-2 border-neutral-950 bg-slate-100 text-neutral-950">
          <Lock className="h-4 w-4 text-neutral-950" />
          <AlertTitle>Zápis je uzamčen po 24 hodinách</AlertTitle>
          <AlertDescription className="text-neutral-900">
            Tento den již nelze upravovat ani odesílat. Záznam je k dispozici jen ke čtení.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
        <Card className={cn(cardBox, "overflow-hidden")}>
          <CardHeader className="space-y-1 pb-2">
            <CardTitle className={cardTitle}>Den</CardTitle>
            <CardDescription className={cardDesc}>Vyberte pracovní den</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-stretch p-3 sm:p-4">
            <div className="flex justify-center">
              <Calendar
                mode="single"
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                selected={selectedDay}
                onSelect={(d) => {
                  if (d) {
                    setSelectedDay(d);
                    setCalendarMonth(d);
                  }
                }}
                locale={cs}
                modifiers={calendarModifiers}
                modifiersClassNames={calendarModifiersClassNames}
                className="rounded-lg border-2 border-neutral-950 bg-white p-2"
              />
            </div>
            {selectedDayMarker ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t-2 border-neutral-950 pt-3 text-xs text-neutral-900">
                <span className="font-semibold text-neutral-950">Stav dne:</span>
                <Badge variant="outline" className="border-2 border-neutral-950 bg-white text-neutral-950">
                  {selectedDayMarker === "no_shift"
                    ? "Bez docházky"
                    : selectedDayMarker === "work_no_report"
                      ? "Čeká výkaz"
                      : selectedDayMarker === "draft"
                        ? "Rozpracováno"
                        : selectedDayMarker === "pending"
                          ? "Odesláno ke schválení"
                          : selectedDayMarker === "approved"
                            ? "Schváleno"
                            : selectedDayMarker === "returned"
                              ? "K úpravě"
                              : selectedDayMarker === "rejected"
                                ? "Zamítnuto"
                                : selectedDayMarker === "locked_timeout"
                                  ? "Uzamčeno (24 h)"
                                  : "—"}
                </Badge>
              </div>
            ) : null}
            <div className="mt-4 space-y-2 border-t-2 border-neutral-950 pt-3 text-[11px] leading-snug text-neutral-900">
              <p className="font-semibold text-neutral-950">Legenda kalendáře</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                <li className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded border border-neutral-400 bg-neutral-100" />{" "}
                  Bez docházky
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded border-2 border-amber-600 bg-amber-100" />{" "}
                  Čeká výkaz
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded border-2 border-orange-600 bg-orange-100" />{" "}
                  Rozpracováno
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded border-2 border-amber-800 bg-amber-200" />{" "}
                  Ke schválení
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded border-2 border-emerald-700 bg-emerald-100" />{" "}
                  Schváleno
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded border-2 border-violet-700 bg-violet-100" />{" "}
                  K úpravě
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded border-2 border-red-700 bg-red-100" />{" "}
                  Zamítnuto
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded border-2 border-neutral-950 bg-slate-200" />{" "}
                  Uzamčeno (24 h)
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className={cn(cardBox, "overflow-hidden")}>
            <CardHeader className="space-y-1 pb-2">
              <CardTitle className={cardTitle}>Docházka pro {dayKey}</CardTitle>
              <CardDescription className={cardDesc}>
                Shrnutí záznamů příchodu a odchodu
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed text-neutral-900">
              {attendanceLoading ? (
                <p className="flex items-center gap-2 text-neutral-800">
                  <Loader2 className="h-4 w-4 animate-spin" /> Načítám…
                </p>
              ) : daySummary ? (
                <>
                  <p>
                    <span className="font-medium text-neutral-950">Příchod:</span>{" "}
                    {daySummary.checkIn ?? "—"}
                  </p>
                  <p>
                    <span className="font-medium text-neutral-950">Odchod:</span>{" "}
                    {daySummary.checkOut ?? "—"}
                  </p>
                  <p>
                    <span className="font-medium text-neutral-950">Odpracováno (odhad):</span>{" "}
                    <span className="font-semibold tabular-nums text-neutral-950">
                      {daySummary.hoursWorked != null ? `${daySummary.hoursWorked} h` : "—"}
                    </span>
                  </p>
                  <p className="text-neutral-900">{daySummary.statusLabel}</p>
                </>
              ) : (
                <p className="text-neutral-900">Pro tento den nejsou záznamy docházky.</p>
              )}
            </CardContent>
          </Card>

          <Card className={cn(cardBox, "overflow-hidden")}>
            <CardHeader className="space-y-1 pb-2">
              <CardTitle className={cardTitle}>Úseky práce (terminál)</CardTitle>
              <CardDescription className={cardDesc}>
                Evidence z docházky — částky jsou orientační do schválení výkazu administrátorem.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-neutral-900">
              {segmentsDayLoading ? (
                <p className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Načítám segmenty…
                </p>
              ) : closedSegments.length === 0 ? (
                <p>
                  Za tento den nejsou k dispozici žádné uzavřené úseky z terminálu — výkaz můžete vyplnit z
                  odpracované docházky (viz karta výše). Úseky z terminálu jsou jen doplňkový přehled.
                </p>
              ) : (
                <ul className="space-y-3">
                  {closedSegments.map((seg: WorkSegmentClient) => {
                    const st = seg.sourceType === "tariff" ? "Tarif" : "Zakázka";
                    const name =
                      typeof seg.displayName === "string"
                        ? seg.displayName
                        : String(seg.jobName || seg.tariffName || "—");
                    const dh = segmentDurationHours(seg);
                    const h = dh > 0 ? `${dh} h` : "—";
                    const amt =
                      typeof seg.totalAmountCzk === "number"
                        ? formatKc(seg.totalAmountCzk)
                        : "—";
                    const lk = getTerminalSegmentLockKind(seg);
                    const lockHint =
                      lk === "none"
                        ? "Úsek lze rozvrhnout ve výkazu"
                        : lk === "tariff_terminal"
                          ? "Tarif — automaticky, bez formuláře"
                          : "Uzamčeno z terminálu — v hlavním formuláři se nevyplňuje";
                    return (
                      <li
                        key={seg.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border-2 border-neutral-950 bg-white px-3 py-3"
                      >
                        <div>
                          <span className="text-xs font-semibold uppercase text-neutral-950">{st}</span>
                          <p className="font-semibold text-neutral-950">{name}</p>
                          <p className="text-xs text-neutral-900">{segmentTimeRangeLabel(seg)}</p>
                          <p className="mt-1 text-[11px] text-neutral-900">{lockHint}</p>
                        </div>
                        <div className="text-right text-xs tabular-nums text-neutral-950">
                          <p>{h}</p>
                          <p className="text-neutral-800">{amt}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className={cn(cardBox, "overflow-hidden")}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
              <div className="space-y-1">
                <CardTitle className={cardTitle}>Výkaz za den</CardTitle>
                <CardDescription className={cardDesc}>
                  Popište vykonanou práci — odesláním požádáte o schválení
                </CardDescription>
              </div>
              {status ? (
                <div className="flex flex-col items-end gap-1">
                  <Badge
                    className={cn(
                      status === "draft" && "bg-slate-600",
                      status === "approved" && "bg-emerald-600",
                      status === "pending" && "bg-amber-500",
                      status === "rejected" && "bg-red-600",
                      status === "returned" && "bg-violet-600"
                    )}
                  >
                    {status === "draft"
                      ? "Rozpracováno"
                      : status === "pending"
                        ? "Odesláno ke schválení"
                        : status === "approved"
                          ? "Schváleno"
                          : status === "returned"
                            ? "K úpravě"
                            : status === "rejected"
                              ? "Zamítnuto"
                              : status}
                  </Badge>
                  {status === "approved" &&
                  typeof existingReport?.payableAmountCzk === "number" ? (
                    <span className="text-xs font-medium text-neutral-950">
                      Částka k výplatě: {formatKc(existingReport.payableAmountCzk as number)}
                    </span>
                  ) : null}
                </div>
              ) : reportLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-neutral-950" />
              ) : null}
            </CardHeader>
            <CardContent className="space-y-6 sm:space-y-7">
              <div className="rounded-lg border-2 border-neutral-950 bg-white p-4 text-sm leading-relaxed text-neutral-900">
                <p className="font-medium text-neutral-950">Jak funguje výkaz za den</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>
                    <strong className="text-neutral-950">Úseky z terminálu</strong> jsou jen informativní
                    přehled (včetně tarifů).
                  </li>
                  <li>
                    <strong className="text-neutral-950">Tarif</strong> z terminálu se započte automaticky,
                    odečte se z času pro výkaz a <strong className="text-neutral-950">nevyplňuje se</strong> —
                    oceňuje se podle ceníku tarifu.
                  </li>
                  <li>
                    <strong className="text-neutral-950">Hlavní formulář</strong> pod tím slouží jen k
                    rozdělení zbývajícího času (bez tarifů): hodiny, popis, volitelná zakázka; řádky se
                    čerpají na úseky bez výběru v terminálu.
                  </li>
                </ul>
              </div>

              <div className="rounded-lg border-2 border-neutral-950 bg-white p-4 text-sm text-neutral-900">
                <p className="font-medium text-neutral-950">Ruční výběr zakázky</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-800">
                  Zakázky níže jsou přiřazené k vašemu účtu v systému — nezávisle na tom, co jste vybrali na
                  terminálu docházky.
                </p>
                {jobsLoading ? (
                  <p className="mt-2 flex items-center gap-2 text-xs text-neutral-900">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Načítání přiřazených zakázek…
                  </p>
                ) : assignedJobIds.length === 0 ? (
                  <p className="mt-2 text-sm font-medium text-neutral-950">Nemáte přiřazené žádné zakázky.</p>
                ) : (
                  <p className="mt-2 text-sm text-neutral-900">
                    U každého řádku hlavního výkazu je pole <strong className="text-neutral-950">Zakázka</strong>{" "}
                    ({assignedJobs.length} přiřazených) — můžete zvolit zakázku nebo „Bez zakázky / interní práce“.
                  </p>
                )}
              </div>

              {segmentsDayLoading ? (
                <p className="flex items-center gap-2 text-sm text-neutral-900">
                  <Loader2 className="h-4 w-4 animate-spin" /> Načítám úseky pro výkaz…
                </p>
              ) : null}

              {!segmentsDayLoading &&
              closedSegments.length === 0 &&
              daySummary != null &&
              daySummary.hoursWorked != null &&
              daySummary.hoursWorked > 0 && (
                <Alert className="border-2 border-blue-200 bg-blue-50 text-blue-950">
                  <AlertTitle>Informace</AlertTitle>
                  <AlertDescription className="text-blue-900">
                    Chybí odpovídající úseky z terminálu — výkaz přesto vyplňte podle odpracovaného času z docházky
                    ({daySummary.hoursWorked} h). Úseky z terminálu nejsou povinné.
                  </AlertDescription>
                </Alert>
              )}

              {closedSegments.length > 0 ? (
                <div className="space-y-5">
                  {dataAttendanceTooLow ? (
                    <p className="rounded-lg border-2 border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-900">
                      Součet úseků z terminálu ({segmentTotal} h) je vyšší než odpracovaný čas z docházky (
                      {attendanceHours} h). Výkaz nelze uložit — vyřešte nesoulad u administrátora.
                    </p>
                  ) : null}

                  {tariffSum > 0 ? (
                    <p className="rounded-lg border-2 border-neutral-950 bg-white px-4 py-3 text-sm text-neutral-950">
                      <span className="font-semibold tabular-nums">{tariffSum} h</span> z tarifu z terminálu
                      se započítá automaticky (needitovatelné) a odečte se z času pro výkaz níže.
                    </p>
                  ) : null}
                  {jobTerminalSumOnly > 0 ? (
                    <p className="rounded-lg border-2 border-neutral-950 bg-white px-4 py-3 text-sm text-neutral-950">
                      <span className="font-semibold tabular-nums">{jobTerminalSumOnly} h</span> je uzamčeno
                      zakázkou vybranou v terminálu — výběr zakázky ve formuláři se netýká těchto úseků.
                    </p>
                  ) : null}

                  {jobTerminalSegments.length > 0 ? (
                    <div className="space-y-3 rounded-lg border-2 border-neutral-950 bg-white p-4">
                      <p className="text-sm font-medium text-neutral-950">
                        Zakázka z terminálu — volitelný popis
                      </p>
                      <p className="text-xs text-neutral-900">
                        Zakázka je již určena terminálem. Můžete doplnit, co jste na ní dělali.
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {jobTerminalSegments.map((seg) => {
                          const dur = segmentDurationHours(seg);
                          const jn =
                            String(seg.jobName || seg.displayName || "").trim() || "Zakázka z terminálu";
                          const autoAp = isJobTerminalAutoApprovedSegmentData(
                            seg as unknown as Record<string, unknown>
                          );
                          return (
                            <div key={seg.id} className="space-y-1.5">
                              <Label className="flex flex-wrap items-center gap-2 text-xs text-neutral-900">
                                <span>
                                  {jn} · {segmentTimeRangeLabel(seg)} · {dur > 0 ? `${dur} h` : "—"}
                                </span>
                                {autoAp ? (
                                  <Badge variant="secondary" className="font-normal">
                                    Automaticky schváleno
                                  </Badge>
                                ) : null}
                              </Label>
                              <Textarea
                                rows={3}
                                className="min-h-[88px] border-2 border-neutral-950 text-neutral-950"
                                placeholder="Volitelně: co jste na zakázce dělali…"
                                value={jobTerminalLineNotes[seg.id] ?? ""}
                                onChange={(e) =>
                                  setJobTerminalLineNotes((prev) => ({
                                    ...prev,
                                    [seg.id]: e.target.value,
                                  }))
                                }
                                disabled={effectiveFormLocked || dailyWorkLogOff}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {capMismatch ? (
                    <p className="text-xs leading-relaxed text-neutral-900">
                      Pozn.: součet úseků z terminálu ({segmentTotal} h) se liší od docházky (
                      {attendanceHours} h). Rozvržení se váže na úseky terminálu; docházku vidíte v kartě
                      výše.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!segmentsDayLoading && dayWorkedCap > 0 ? (
                <div className="space-y-5">
                  <div
                    className={cn(
                      "grid grid-cols-1 gap-3 rounded-lg border-2 px-3 py-3 text-sm sm:grid-cols-2 lg:grid-cols-5",
                      overCap || overUnlocked
                        ? "border-red-600 bg-red-50"
                        : "border-neutral-950 bg-white"
                    )}
                  >
                    <div>
                      <span className="font-medium text-neutral-950">Odpracováno celkem</span>
                      <p className="font-semibold tabular-nums text-neutral-950">
                        {dayWorkedCap > 0 ? `${dayWorkedCap} h` : "—"}
                      </p>
                      <p className="text-xs text-neutral-900">Strop z docházky a úseků</p>
                    </div>
                    <div>
                      <span className="font-medium text-neutral-950">Čas v tarifech</span>
                      <p className="font-semibold tabular-nums text-neutral-950">
                        {tariffSum > 0 ? `${tariffSum} h` : "—"}
                      </p>
                      <p className="text-xs text-neutral-900">Automaticky, bez formuláře</p>
                    </div>
                    <div>
                      <span className="font-medium text-neutral-950">Dostupný pro výkaz</span>
                      <p className="font-semibold tabular-nums text-neutral-950">
                        {dayWorkedCap > 0 ? `${dostupnýProŘádkyZobrazení} h` : "—"}
                      </p>
                      <p className="text-xs text-neutral-900">Odpracováno − tarif − zakázka z terminálu</p>
                    </div>
                    <div>
                      <span className="font-medium text-neutral-950">Rozděleno</span>
                      <p className="font-semibold tabular-nums text-neutral-950">{allocatedUnlocked} h</p>
                      <p className="text-xs text-neutral-900">
                        Ve formuláři · celkem s terminálem {rozdělenoCelkem} h · zbývá ve formuláři{" "}
                        {zbýváVeFormuláři} h
                      </p>
                    </div>
                    <div>
                      <span className="font-medium text-neutral-950">Zbývá</span>
                      <p
                        className={cn(
                          "font-semibold tabular-nums",
                          (overCap || zbýváCap < -SUM_COMPARE_EPS) && "text-red-700"
                        )}
                      >
                        {overCap ? "—" : `${zbýváCap} h`}
                      </p>
                      <p className="text-xs text-neutral-900">Do stropu odpracování</p>
                    </div>
                  </div>
                  {typeof existingReport?.estimatedLaborFromSegmentsCzk === "number" &&
                  existingReport.estimatedLaborFromSegmentsCzk > 0 ? (
                    <p className="rounded-lg border-2 border-neutral-950 bg-white px-3 py-2 text-xs text-neutral-900">
                      <strong className="text-neutral-950">Odhad výdělku z uloženého výkazu:</strong>{" "}
                      {formatKc(existingReport.estimatedLaborFromSegmentsCzk as number)} (tarify podle ceníku
                      tarifu, zakázky a interní práce podle sazeb a vaší výchozí sazby).
                    </p>
                  ) : null}
                  {(overCap || overUnlocked) && (
                    <p className="text-sm font-medium text-red-700">
                      Součet hodin překračuje dostupný čas — upravte řádky ve výkazu.
                    </p>
                  )}

                  {noTimeLeftToSplit ? (
                    <p className="rounded-lg border-2 border-neutral-950 bg-white px-4 py-3 text-sm text-neutral-950">
                      Pro tento den není žádný čas k rozdělení do řádků níže — tarify a uzamčené zakázky z
                      terminálu pokrývají celé odpracované hodiny.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-3 rounded-lg border-2 border-neutral-950 bg-white p-4">
                <p className="text-sm font-medium text-neutral-950">
                  Hlavní řádky výkazu — hodiny, popis, zakázka
                </p>
                <p className="text-xs text-neutral-900">
                  {closedSegments.length === 0
                    ? formEditableByAttendance
                      ? `Bez úseků z terminálu vyplňte hodiny podle docházky — celkem až ${round2(formHoursCap)} h; součet řádků musí odpovídat odpracovanému času.`
                      : "Pro vyplnění výkazu potřebujete v docházce kladný odpracovaný čas."
                    : formHoursCap > SUM_COMPARE_EPS
                      ? `Řádky se čerpají na úseky z terminálu v čase. Součet hodin musí odpovídat až ${round2(formHoursCap)} h (bez tarifů a uzamčených zakázek z terminálu).`
                      : noTimeLeftToSplit
                        ? "Žádné hodiny k ručnímu rozvržení — zůstaly jen tarify a zakázky uzamčené z terminálu."
                        : "Hodiny nelze upravit (např. funkce vypnutá nebo uzamčení výkazu). Popis a zakázku lze měnit jen pokud to stav dovolí."}
                </p>
                {jobsLoading ? (
                  <p className="flex items-center gap-2 text-xs text-neutral-900">
                    <Loader2 className="h-4 w-4 animate-spin text-neutral-950" />
                    Načítání přiřazených zakázek…
                  </p>
                ) : assignedJobIds.length === 0 ? (
                  <p className="rounded-lg border-2 border-neutral-950 bg-white px-3 py-2 text-xs text-neutral-900">
                    Nemáte přiřazené žádné zakázky — v rozbalovacím poli je jen „Bez zakázky / interní práce“.
                  </p>
                ) : (
                  <p className="text-xs text-neutral-900">
                    Vyberte zakázku nebo ponechte „Bez zakázky / interní práce“ (nezávisle na terminálu).
                  </p>
                )}
                <div className="space-y-3">
                  {dayFormRows.map((row) => (
                    <div
                      key={row.rowId}
                      className="flex flex-col gap-3 rounded-lg border-2 border-neutral-950 bg-white p-3 lg:grid lg:grid-cols-[100px_1fr_minmax(0,1fr)_auto] lg:items-end lg:gap-3"
                    >
                      <div className="w-full space-y-1.5 lg:w-auto">
                        <Label className="text-xs font-medium text-neutral-950">
                          Hodiny <span className="text-red-700">*</span>
                        </Label>
                        <Input
                          inputMode="decimal"
                          className="h-11 min-h-[44px] border-2 border-neutral-950 tabular-nums text-neutral-950"
                          placeholder="např. 1,5"
                          value={row.hoursStr}
                          onChange={(e) =>
                            setDayFormRows((prev) =>
                              prev.map((x) =>
                                x.rowId === row.rowId ? { ...x, hoursStr: e.target.value } : x
                              )
                            )
                          }
                          disabled={hoursDisabled}
                        />
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <Label className="text-xs font-medium text-neutral-950">Popis práce</Label>
                        <Textarea
                          rows={2}
                          className="min-h-[72px] border-2 border-neutral-950 text-neutral-950"
                          placeholder="Co jste dělali (povinné u řádku bez zakázky)…"
                          value={row.lineNote}
                          onChange={(e) =>
                            setDayFormRows((prev) =>
                              prev.map((x) =>
                                x.rowId === row.rowId ? { ...x, lineNote: e.target.value } : x
                              )
                            )
                          }
                          disabled={effectiveFormLocked || dailyWorkLogOff}
                        />
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <Label className="text-xs font-medium text-neutral-950">Zakázka</Label>
                        <p className="text-[10px] leading-tight text-neutral-800">volitelné</p>
                        <select
                          className="mt-1 flex h-11 min-h-[44px] w-full rounded-md border-2 border-neutral-950 bg-white px-3 text-sm text-neutral-950"
                          value={row.jobId}
                          onChange={(e) =>
                            setDayFormRows((prev) =>
                              prev.map((x) =>
                                x.rowId === row.rowId ? { ...x, jobId: e.target.value } : x
                              )
                            )
                          }
                          disabled={jobSelectDisabled}
                        >
                          <option value="">Bez zakázky / interní práce</option>
                          {assignedJobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {j.name || j.id}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex justify-end lg:justify-center">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 border-2 border-neutral-950 bg-white"
                          disabled={
                            effectiveFormLocked || dailyWorkLogOff || dayFormRows.length <= 1
                          }
                          onClick={() =>
                            setDayFormRows((prev) => {
                              const next = prev.filter((x) => x.rowId !== row.rowId);
                              return next.length > 0
                                ? next
                                : [
                                    {
                                      rowId: newSplitRowId(),
                                      jobId: "",
                                      hoursStr: "",
                                      lineNote: "",
                                    },
                                  ];
                            })
                          }
                          aria-label="Smazat řádek"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-[44px] w-full border-2 border-neutral-950 bg-white text-neutral-950 hover:bg-neutral-100 sm:w-auto"
                  disabled={hoursDisabled}
                  onClick={() =>
                    setDayFormRows((prev) => [
                      ...prev,
                      {
                        rowId: newSplitRowId(),
                        jobId: "",
                        hoursStr: "",
                        lineNote: "",
                      },
                    ])
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Přidat řádek
                </Button>
              </div>

              <div className="space-y-2 rounded-lg border-2 border-neutral-950 bg-white p-4">
                <Label htmlFor="dr-note" className="text-neutral-950">
                  Poznámka
                </Label>
                <Textarea
                  id="dr-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={effectiveFormLocked}
                  rows={2}
                  className="border-2 border-neutral-950 text-neutral-950"
                />
              </div>

              {status === "pending" ? (
                <p className="rounded-lg border-2 border-neutral-950 bg-white px-4 py-3 text-sm text-neutral-950">
                  Výkaz čeká na schválení. Úpravy nejsou možné, dokud ho administrátor nevrátí nebo
                  nezamítne.
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button
                  type="button"
                  variant="default"
                  className="min-h-[48px] w-full sm:w-auto"
                  disabled={
                    saving ||
                    privileged ||
                    effectiveFormLocked ||
                    dailyWorkLogOff ||
                    dayWorkedCap <= SUM_COMPARE_EPS ||
                    dataAttendanceTooLow
                  }
                  onClick={() => void postReport("draft")}
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Uložit rozpracováno"}
                </Button>
                <Button
                  type="button"
                  variant="success"
                  className="min-h-[48px] w-full sm:w-auto"
                  disabled={
                    saving ||
                    privileged ||
                    effectiveFormLocked ||
                    dailyWorkLogOff ||
                    dayWorkedCap <= SUM_COMPARE_EPS ||
                    dataAttendanceTooLow
                  }
                  onClick={() => void postReport("submit")}
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Odeslat ke schválení"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
