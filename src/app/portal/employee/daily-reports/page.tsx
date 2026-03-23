"use client";

import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import {
  doc,
  collection,
  query,
  where,
  limit,
  getDocs,
  documentId,
} from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, AlertCircle, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { summarizeAttendanceByDay } from "@/lib/employee-attendance";
import { parseAssignedWorklogJobIds, chunkArray } from "@/lib/assigned-jobs";
import { useEmployeeUiLang } from "@/hooks/use-employee-ui-lang";
import { cn } from "@/lib/utils";
import { formatKc } from "@/lib/employee-money";
import { isDailyWorkLogEnabled } from "@/lib/employee-report-flags";
import {
  type WorkSegmentClient,
  closedTerminalSegmentsForDay,
  getTerminalSegmentLockKind,
  segmentTimeRangeLabel,
  sortSegmentsByStart,
} from "@/lib/work-segment-client";
import {
  type DayFormRow,
  buildFullSegmentJobSplits,
  effectiveLockedUnlocked,
  mergeUnlockedRowsFromReport,
  segmentDurationHours,
  sumClosedSegmentHours,
} from "@/lib/daily-work-report-day-form";

const SPLIT_EPS = 0.02;

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
  const assigned = new Set(assignedJobIds);
  const { unlocked } = effectiveLockedUnlocked(closedSegments);
  const unlockedSum = sumClosedSegmentHours(unlocked);

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
    if (sum > unlockedSum + SPLIT_EPS) {
      return `Součet hodin v řádcích (${sum} h) překračuje čas odemčených úseků (${unlockedSum} h).`;
    }
    if (sum < unlockedSum - SPLIT_EPS) {
      return `Rozdělte celých ${unlockedSum} h (zbývá ${Math.round((unlockedSum - sum) * 100) / 100} h).`;
    }
  }

  const rozděleno = lockedSum + sum;
  if (rozděleno > dayWorkedCap + SPLIT_EPS) {
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
  const { companyName } = useCompany();

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
  const { data: employeeDoc } = useDoc<any>(employeeRef);

  const assignedJobIds = useMemo(() => parseAssignedWorklogJobIds(employeeDoc), [employeeDoc]);
  const assignedJobIdsKey = useMemo(() => assignedJobIds.slice().sort().join("|"), [assignedJobIds]);

  const [assignedJobs, setAssignedJobs] = useState<{ id: string; name?: string }[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  useEffect(() => {
    if (!firestore || !companyId || assignedJobIds.length === 0) {
      setAssignedJobs([]);
      setJobsLoading(false);
      return;
    }
    let cancelled = false;
    setJobsLoading(true);
    void (async () => {
      try {
        const chunks = chunkArray(assignedJobIds, 10);
        const acc: { id: string; name?: string }[] = [];
        for (const chunk of chunks) {
          const q = query(
            collection(firestore, "companies", companyId, "jobs"),
            where(documentId(), "in", chunk)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const data = d.data() as { name?: string };
            acc.push({ id: d.id, name: data.name });
          });
        }
        if (!cancelled) {
          acc.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, "cs"));
          setAssignedJobs(acc);
        }
      } catch (e) {
        console.error("[daily-reports] jobs", e);
        if (!cancelled) setAssignedJobs([]);
      } finally {
        if (!cancelled) setJobsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, assignedJobIdsKey]);

  const attendanceQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !user) return null;
    const ids = [...new Set([employeeId, user.uid].filter(Boolean))] as string[];
    if (ids.length === 0) return null;
    const base = collection(firestore, "companies", companyId, "attendance");
    if (ids.length === 1) {
      return query(base, where("employeeId", "==", ids[0]), limit(500));
    }
    return query(base, where("employeeId", "in", ids), limit(500));
  }, [firestore, companyId, employeeId, user]);

  const { data: attendanceRows = [], isLoading: attendanceLoading } = useCollection(attendanceQuery);
  /** Zaručené pole — useCollection může někdy vrátit nearray, což rozbije agregaci docházky. */
  const attendanceBlocks = useMemo(
    () => (Array.isArray(attendanceRows) ? attendanceRows : []) as Record<string, unknown>[],
    [attendanceRows]
  );

  const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date());
  const dayKey = selectedDay ? format(selectedDay, "yyyy-MM-dd") : "";

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

  const workSegmentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId || !dayKey) return null;
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("employeeId", "==", employeeId),
      where("date", "==", dayKey)
    );
  }, [firestore, companyId, employeeId, dayKey]);

  const { data: workSegmentsRaw = [], isLoading: segmentsLoading } = useCollection<any>(workSegmentsQuery);

  const closedSegments = useMemo(() => {
    const raw = Array.isArray(workSegmentsRaw) ? workSegmentsRaw : [];
    const withId = raw.map((s: Record<string, unknown> & { id?: string }) => ({
      ...s,
      id: String(s.id ?? ""),
    })) as WorkSegmentClient[];
    return sortSegmentsByStart(closedTerminalSegmentsForDay(withId, dayKey));
  }, [workSegmentsRaw, dayKey]);

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

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const hours = daySummary?.hoursWorked ?? null;
    const segH = sumClosedSegmentHours(closedSegments);
    console.log("[daily-reports] attendanceBlocks.length", attendanceBlocks.length);
    console.log("[daily-reports] daySummary.hoursWorked", hours);
    console.log("[daily-reports] closedSegments sum", segH);
  }, [attendanceBlocks, daySummary, closedSegments]);

  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  /** Jeden hlavní formulář pro odemčené úseky (čas → zakázky / popis v pořadí úseků). */
  const [dayFormRows, setDayFormRows] = useState<DayFormRow[]>([]);
  /** Volitelný popis u úseků se zakázkou z terminálu (tarify bez formuláře). */
  const [jobTerminalLineNotes, setJobTerminalLineNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existingReport) {
      setDescription(String(existingReport.description ?? ""));
      setNote(String(existingReport.note ?? ""));
      return;
    }
    setDescription("");
    setNote("");
  }, [existingReport, dayKey]);

  useEffect(() => {
    if (!closedSegments.length) {
      setDayFormRows([]);
      setJobTerminalLineNotes({});
      return;
    }
    const { locked, unlocked } = effectiveLockedUnlocked(closedSegments);
    const unlockedSumInit = sumClosedSegmentHours(unlocked);
    let merged = mergeUnlockedRowsFromReport(unlocked, existingReport);
    if (merged.length === 0 && unlockedSumInit > SPLIT_EPS) {
      merged = [
        {
          rowId: newSplitRowId(),
          jobId: "",
          hoursStr: String(unlockedSumInit).replace(".", ","),
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
  }, [existingReport, dayKey, closedSegmentIdsKey, closedSegments]);

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
    if (closedSegments.length === 0) {
      toast({
        variant: "destructive",
        title: "Nelze uložit výkaz",
        description:
          "Pro tento den nejsou žádné uzavřené úseky z docházkového terminálu. Bez docházky nelze vytvořit výkaz.",
      });
      return;
    }
    const attPost = daySummary?.hoursWorked ?? null;
    const segTotPost = sumClosedSegmentHours(closedSegments);
    if (
      attPost != null &&
      Number.isFinite(attPost) &&
      segTotPost > attPost + SPLIT_EPS
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
    if (mode === "submit" && !description.trim()) {
      toast({ variant: "destructive", title: "Chybí popis", description: "Vyplňte, co jste dělali." });
      return;
    }
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const segmentJobSplits = buildFullSegmentJobSplits(
        closedSegments,
        dayFormRows,
        parseHoursInput
      );
      const dayWorkLines = dayFormRows.map((r) => ({ lineNote: r.lineNote.trim() }));
      const segmentLineNotes = { ...jobTerminalLineNotes };
      const res = await fetch("/api/employee/daily-work-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          companyId,
          date: dayKey,
          description: description.trim(),
          note: note.trim(),
          segmentJobSplits,
          dayWorkLines,
          segmentLineNotes,
          mode,
        }),
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
    segmentTotal > attendanceHours + SPLIT_EPS;
  /** Odpracováno − tarif (informace; ve formuláři jen část bez tarifu a uzamčených zakázek). */
  const dostupnýPoTarifu = Math.max(
    0,
    Math.round((dayWorkedCap - tariffSum) * 100) / 100
  );
  const allocatedUnlocked = sumDayFormHours(dayFormRows);
  const rozdělenoCelkem = Math.round((lockedSum + allocatedUnlocked) * 100) / 100;
  const zbýváCap = Math.round((dayWorkedCap - rozdělenoCelkem) * 100) / 100;
  const overCap = rozdělenoCelkem > dayWorkedCap + SPLIT_EPS;
  const overUnlocked = allocatedUnlocked > unlockedSum + SPLIT_EPS;
  const capMismatch =
    attendanceHours != null &&
    Number.isFinite(attendanceHours) &&
    Math.abs(attendanceHours - segmentTotal) > SPLIT_EPS &&
    !dataAttendanceTooLow;

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">{t("loadingAuth")}</p>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-600">
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
          Denní výkaz práce
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-900 sm:text-base">
          Ke každému dni doplňte popis práce — navazuje na docházku (příchod / odchod).{" "}
          {companyName ? <span className="font-semibold">{companyName}</span> : null}
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
        <Card className={cn(cardBox, "overflow-hidden")}>
          <CardHeader className="space-y-1 pb-2">
            <CardTitle className={cardTitle}>Den</CardTitle>
            <CardDescription className={cardDesc}>Vyberte pracovní den</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-3 sm:p-4">
            <Calendar
              mode="single"
              selected={selectedDay}
              onSelect={(d) => d && setSelectedDay(d)}
              locale={cs}
              className="rounded-lg border-2 border-neutral-950 bg-white p-2"
            />
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
              {segmentsLoading ? (
                <p className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Načítám segmenty…
                </p>
              ) : closedSegments.length === 0 ? (
                <p>Žádné uzavřené úseky z terminálu za tento den — bez nich nelze sestavit denní výkaz.</p>
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

              {segmentsLoading ? (
                <p className="flex items-center gap-2 text-sm text-neutral-900">
                  <Loader2 className="h-4 w-4 animate-spin" /> Načítám úseky…
                </p>
              ) : closedSegments.length === 0 ? (
                <div className="space-y-2 rounded-lg border-2 border-neutral-950 bg-white px-4 py-3 text-sm text-neutral-950">
                  <p>
                    Pro tento den nejsou žádné uzavřené úseky z docházkového terminálu — výkaz zatím nelze
                    uložit (čeká se na uzavření činností v terminálu).
                  </p>
                  {daySummary != null &&
                  daySummary.hoursWorked != null &&
                  daySummary.hoursWorked > 0 && (
                    <p className="text-xs text-amber-900">
                      V docházce vidíte odpracovaný čas ({daySummary.hoursWorked} h), ale chybí odpovídající
                      úseky z terminálu. Až administrátor nebo synchronizace doplní segmenty, zobrazí se zde
                      formulář pro rozdělení práce.
                    </p>
                  )}
                </div>
              ) : (
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
                          return (
                            <div key={seg.id} className="space-y-1.5">
                              <Label className="text-xs text-neutral-900">
                                {jn} · {segmentTimeRangeLabel(seg)} · {dur > 0 ? `${dur} h` : "—"}
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
                                disabled={formLocked || dailyWorkLogOff}
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
                        {dayWorkedCap > 0 ? `${dostupnýPoTarifu} h` : "—"}
                      </p>
                      <p className="text-xs text-neutral-900">Odpracováno − tarif</p>
                    </div>
                    <div>
                      <span className="font-medium text-neutral-950">Rozděleno</span>
                      <p className="font-semibold tabular-nums text-neutral-950">{allocatedUnlocked} h</p>
                      <p className="text-xs text-neutral-900">
                        Ve formuláři · celkem s terminálem {rozdělenoCelkem} h
                      </p>
                    </div>
                    <div>
                      <span className="font-medium text-neutral-950">Zbývá</span>
                      <p
                        className={cn(
                          "font-semibold tabular-nums",
                          (overCap || zbýváCap < -SPLIT_EPS) && "text-red-700"
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

                  {unlockedSegments.length === 0 ? (
                    <p className="rounded-lg border-2 border-neutral-950 bg-white px-4 py-3 text-sm text-neutral-950">
                      Pro tento den není žádný čas k rozdělení ve formuláři (tarify a uzamčené zakázky z
                      terminálu se započítají samy). Volitelně doplňte popis u zakázky z terminálu výše a celkový
                      popis dne níže.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-neutral-950">
                        Rozvržení času ({unlockedSum} h u úseků bez výběru v terminálu)
                      </p>
                      <p className="text-xs text-neutral-900">
                        Řádky se v tomto pořadí čerpají na úseky z terminálu (od prvního časově po další).
                        Součet hodin musí přesně odpovídat {unlockedSum} h. U každého řádku vyberte zakázku
                        nebo nechte prázdné a doplňte popis (např. interní práce).
                      </p>
                      <div className="space-y-3">
                        {dayFormRows.map((row) => (
                          <div
                            key={row.rowId}
                            className="flex flex-col gap-3 rounded-lg border-2 border-neutral-950 bg-white p-3 lg:grid lg:grid-cols-[100px_1fr_minmax(0,1fr)_auto] lg:items-end lg:gap-3"
                          >
                            <div className="w-full space-y-1.5 lg:w-auto">
                              <Label className="text-xs font-medium text-neutral-950">Hodiny *</Label>
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
                                disabled={formLocked || dailyWorkLogOff}
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
                                disabled={formLocked || dailyWorkLogOff}
                              />
                            </div>
                            <div className="min-w-0 space-y-1.5">
                              <Label className="text-xs font-medium text-neutral-950">
                                Zakázka (volitelné)
                              </Label>
                              <select
                                className="flex h-11 min-h-[44px] w-full rounded-md border-2 border-neutral-950 bg-white px-3 text-sm text-neutral-950"
                                value={row.jobId}
                                onChange={(e) =>
                                  setDayFormRows((prev) =>
                                    prev.map((x) =>
                                      x.rowId === row.rowId ? { ...x, jobId: e.target.value } : x
                                    )
                                  )
                                }
                                disabled={formLocked || jobsLoading || dailyWorkLogOff}
                              >
                                <option value="">— bez zakázky / interní —</option>
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
                                  formLocked || dailyWorkLogOff || dayFormRows.length <= 1
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
                        disabled={formLocked || dailyWorkLogOff}
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
                  )}
                </div>
              )}

              <div className="space-y-2 rounded-lg border-2 border-neutral-950 bg-white p-4">
                <Label htmlFor="dr-desc" className="text-neutral-950">
                  Co jste dělali {status !== "draft" && !formLocked ? "*" : ""}
                </Label>
                <Textarea
                  id="dr-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={formLocked}
                  rows={4}
                  placeholder="Stručný popis úkolů…"
                  className="border-2 border-neutral-950 text-neutral-950"
                />
              </div>

              <div className="space-y-2 rounded-lg border-2 border-neutral-950 bg-white p-4">
                <Label htmlFor="dr-note" className="text-neutral-950">
                  Poznámka
                </Label>
                <Textarea
                  id="dr-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={formLocked}
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
                    formLocked ||
                    dailyWorkLogOff ||
                    closedSegments.length === 0 ||
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
                    formLocked ||
                    dailyWorkLogOff ||
                    closedSegments.length === 0 ||
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
