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
import { Loader2, AlertCircle, Plus, Trash2, Lock } from "lucide-react";
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
  isSegmentLockedFromTerminal,
  segmentTimeRangeLabel,
  sortSegmentsByStart,
} from "@/lib/work-segment-client";

const SPLIT_EPS = 0.02;

type SplitRow = { rowId: string; jobId: string; hoursStr: string };

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

function sumSplitHours(rows: SplitRow[]): number {
  let s = 0;
  for (const r of rows) {
    const h = parseHoursInput(r.hoursStr);
    if (h != null) s += h;
  }
  return Math.round(s * 100) / 100;
}

function buildInitialSplitRows(
  segments: WorkSegmentClient[],
  report: Record<string, unknown> | null | undefined
): Record<string, SplitRow[]> {
  const out: Record<string, SplitRow[]> = {};
  const saved = report?.segmentJobSplits;
  const bySegSaved = new Map<string, SplitRow[]>();
  if (Array.isArray(saved) && saved.length > 0) {
    for (const item of saved as { segmentId?: string; jobId?: string; hours?: number }[]) {
      const sid = String(item.segmentId || "").trim();
      const jid = String(item.jobId || "").trim();
      const hr = typeof item.hours === "number" && Number.isFinite(item.hours) ? item.hours : 0;
      if (!sid || !jid || hr <= 0) continue;
      if (!bySegSaved.has(sid)) bySegSaved.set(sid, []);
      bySegSaved.get(sid)!.push({
        rowId: newSplitRowId(),
        jobId: jid,
        hoursStr: String(hr).replace(".", ","),
      });
    }
  }

  const alloc = report?.segmentAllocations;
  const byAlloc = new Map<string, string>();
  if (Array.isArray(alloc)) {
    for (const a of alloc as { segmentId?: string; jobId?: string }[]) {
      const sid = String(a.segmentId || "").trim();
      const jid = String(a.jobId || "").trim();
      if (sid && jid) byAlloc.set(sid, jid);
    }
  }
  const legacyJob = typeof report?.jobId === "string" ? report.jobId.trim() : "";

  for (const seg of segments) {
    const termJid = String(seg.jobId || "").trim();
    if (isSegmentLockedFromTerminal(seg) && termJid) {
      const dur =
        typeof seg.durationHours === "number" && seg.durationHours > 0 ? seg.durationHours : 0;
      out[seg.id] = [
        {
          rowId: newSplitRowId(),
          jobId: termJid,
          hoursStr: dur > 0 ? String(dur).replace(".", ",") : "",
        },
      ];
      continue;
    }

    const fromSaved = bySegSaved.get(seg.id);
    if (fromSaved && fromSaved.length > 0) {
      out[seg.id] = fromSaved;
      continue;
    }

    const dur =
      typeof seg.durationHours === "number" && seg.durationHours > 0 ? seg.durationHours : 0;
    const jid = byAlloc.get(seg.id) || legacyJob;
    out[seg.id] = [
      {
        rowId: newSplitRowId(),
        jobId: jid,
        hoursStr: dur > 0 ? String(dur).replace(".", ",") : "",
      },
    ];
  }
  return out;
}

function validateSplitsForSubmit(
  segments: WorkSegmentClient[],
  rowsBySegment: Record<string, SplitRow[]>,
  mode: "draft" | "submit"
): string | null {
  for (const seg of segments) {
    const dur =
      typeof seg.durationHours === "number" && Number.isFinite(seg.durationHours)
        ? seg.durationHours
        : 0;
    if (dur <= 0) {
      return `Úsek ${segmentTimeRangeLabel(seg)} nemá platnou délku — nelze uložit.`;
    }
    const rows = rowsBySegment[seg.id] ?? [];
    const termJid = String(seg.jobId || "").trim();
    const locked = isSegmentLockedFromTerminal(seg) && Boolean(termJid);

    if (locked) {
      if (rows.length !== 1) {
        return `U úseku ${segmentTimeRangeLabel(seg)} byla v terminálu vybrána zakázka — rozdělení času není povoleno (očekává se jeden řádek).`;
      }
      const r = rows[0];
      const jid = String(r.jobId || "").trim();
      const h = parseHoursInput(r.hoursStr);
      if (jid !== termJid) {
        return `Zakázka musí odpovídat výběru v terminálu u úseku ${segmentTimeRangeLabel(seg)}.`;
      }
      if (h == null || Math.abs(h - dur) > SPLIT_EPS) {
        return `U úseku z terminálu s vybranou zakázkou musí být uvedeno přesně ${dur} h.`;
      }
      continue;
    }

    const filled = rows.filter((row) => {
      const jid = String(row.jobId || "").trim();
      const h = parseHoursInput(row.hoursStr);
      return Boolean(jid && h != null);
    });
    if (filled.length === 0) {
      return `U úseku ${segmentTimeRangeLabel(seg)} přidejte alespoň jeden řádek se zakázkou a hodinami.`;
    }
    let sum = 0;
    for (const r of filled) {
      sum += parseHoursInput(r.hoursStr)!;
    }
    sum = Math.round(sum * 100) / 100;
    if (sum > dur + SPLIT_EPS) {
      return `U úseku ${segmentTimeRangeLabel(seg)} je součet hodin (${sum} h) větší než odpracovaný čas (${dur} h).`;
    }
    if (mode === "submit" && sum < dur - SPLIT_EPS) {
      return `U úseku ${segmentTimeRangeLabel(seg)} musí být rozvrženo celých ${dur} h (zbývá ${Math.round((dur - sum) * 100) / 100} h).`;
    }
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
    () => closedSegments.map((s) => s.id).join("|"),
    [closedSegments]
  );

  const daySummary = useMemo(() => {
    const rows = Array.isArray(attendanceRows) ? attendanceRows : [];
    const summaries = summarizeAttendanceByDay(rows as any[], {
      employeeId,
      authUid: user?.uid,
    });
    return summaries.find((s) => s.date === dayKey) ?? null;
  }, [attendanceRows, dayKey, employeeId, user?.uid]);

  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  /** Rozdělení hodin mezi zakázky po řádcích pro každý uzavřený úsek terminálu */
  const [segmentSplitRows, setSegmentSplitRows] = useState<Record<string, SplitRow[]>>({});
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
      setSegmentSplitRows({});
      return;
    }
    setSegmentSplitRows(buildInitialSplitRows(closedSegments, existingReport));
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
    const splitErr = validateSplitsForSubmit(closedSegments, segmentSplitRows, mode);
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
      const segmentJobSplits: Array<{ segmentId: string; jobId: string; hours: number }> = [];
      for (const seg of closedSegments) {
        const rows = segmentSplitRows[seg.id] ?? [];
        for (const r of rows) {
          const jid = String(r.jobId || "").trim();
          const h = parseHoursInput(r.hoursStr);
          if (!jid || h == null) continue;
          segmentJobSplits.push({ segmentId: seg.id, jobId: jid, hours: h });
        }
      }
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

  const hasUnlockedSegment = useMemo(
    () => closedSegments.some((s) => !isSegmentLockedFromTerminal(s)),
    [closedSegments]
  );
  const needsAssignedJobsForSave = hasUnlockedSegment && assignedJobs.length === 0;

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

  const status = existingReport?.status as string | undefined;
  const formLocked = status === "approved" || status === "pending";
  const dailyWorkLogOff = !isDailyWorkLogEnabled(employeeDoc);

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
                  {closedSegments.map((seg) => {
                    const st = seg.sourceType === "tariff" ? "Tarif" : "Zakázka";
                    const name =
                      typeof seg.displayName === "string"
                        ? seg.displayName
                        : String(seg.jobName || seg.tariffName || "—");
                    const h =
                      typeof seg.durationHours === "number" ? `${seg.durationHours} h` : "—";
                    const amt =
                      typeof seg.totalAmountCzk === "number"
                        ? formatKc(seg.totalAmountCzk)
                        : "—";
                    return (
                      <li
                        key={seg.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border-2 border-neutral-950 bg-white px-3 py-3"
                      >
                        <div>
                          <span className="text-xs font-semibold uppercase text-neutral-950">{st}</span>
                          <p className="font-semibold text-neutral-950">{name}</p>
                          <p className="text-xs text-neutral-900">{segmentTimeRangeLabel(seg)}</p>
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
              {typeof existingReport?.estimatedLaborFromSegmentsCzk === "number" &&
                existingReport.estimatedLaborFromSegmentsCzk > 0 && (
                  <p className="border-t border-neutral-950 pt-3 text-xs text-neutral-900">
                    Odhad z uzavřených segmentů (výkaz):{" "}
                    <span className="font-semibold tabular-nums text-neutral-950">
                      {formatKc(existingReport.estimatedLaborFromSegmentsCzk)}
                    </span>
                  </p>
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
                <p className="font-medium text-neutral-950">Jak funguje přiřazení zakázek</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>
                    <strong className="text-neutral-950">Zakázka vybraná v terminálu</strong> — čas úseku je
                    pevný a nelze ho rozdělovat ve výkazu (odpovídá záznamu z terminálu).
                  </li>
                  <li>
                    <strong className="text-neutral-950">Bez zakázky v terminálu</strong> (tarif / úsek bez
                    zakázky) — můžete čas rozdělit na více řádků a zakázky doplnit ručně.
                  </li>
                </ul>
              </div>

              {segmentsLoading ? (
                <p className="flex items-center gap-2 text-sm text-neutral-900">
                  <Loader2 className="h-4 w-4 animate-spin" /> Načítám úseky…
                </p>
              ) : closedSegments.length === 0 ? (
                <p className="rounded-lg border-2 border-neutral-950 bg-white px-4 py-3 text-sm text-neutral-950">
                  Pro tento den nejsou žádné uzavřené úseky z docházkového terminálu. Výkaz nelze uložit,
                  dokud nebudou k dispozici uzavřené segmenty (příchod / výběr činnosti / odchod).
                </p>
              ) : (
                <div className="space-y-5">
                  {needsAssignedJobsForSave ? (
                    <p className="rounded-lg border-2 border-neutral-950 bg-white px-4 py-3 text-sm font-medium text-neutral-950">
                      Nemáte přiřazenou žádnou zakázku pro úseky, kde je potřeba doplnit zakázku ručně.
                      Požádejte administrátora o přiřazení zakázek — jinak nelze uložit výkaz (úseky se
                      zakázkou z terminálu můžete stále zkontrolovat níže).
                    </p>
                  ) : null}
                  {closedSegments.map((seg) => {
                    const st = seg.sourceType === "tariff" ? "Tarif" : "Zakázka";
                    const terminalLabel =
                      typeof seg.displayName === "string"
                        ? seg.displayName
                        : String(seg.jobName || seg.tariffName || "Úsek");
                    const dur =
                      typeof seg.durationHours === "number" && Number.isFinite(seg.durationHours)
                        ? seg.durationHours
                        : 0;
                    const rows = segmentSplitRows[seg.id] ?? [];
                    const allocated = sumSplitHours(
                      rows.filter((r) => {
                        const jid = String(r.jobId || "").trim();
                        const h = parseHoursInput(r.hoursStr);
                        return Boolean(jid && h != null);
                      })
                    );
                    const remaining = Math.round((dur - allocated) * 100) / 100;
                    const over = allocated > dur + SPLIT_EPS;
                    const locked = isSegmentLockedFromTerminal(seg);
                    const termJid = String(seg.jobId || "").trim();
                    const jobOptions = (() => {
                      const base = [...assignedJobs];
                      if (termJid && !base.some((j) => j.id === termJid)) {
                        base.push({
                          id: termJid,
                          name: seg.jobName || termJid,
                        });
                      }
                      return base;
                    })();

                    return (
                      <div
                        key={seg.id}
                        className={cn(
                          "rounded-xl border-2 p-4 sm:p-5",
                          locked
                            ? "border-neutral-800 bg-neutral-50"
                            : "border-neutral-950 bg-white"
                        )}
                      >
                        <div className="mb-4 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wide text-neutral-950">
                              {st}
                            </span>
                            {locked ? (
                              <Badge
                                variant="outline"
                                className="border-2 border-neutral-950 bg-white text-neutral-950"
                              >
                                <Lock className="mr-1 h-3 w-3" aria-hidden />
                                Zamčeno
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-2 border-neutral-950 bg-white text-neutral-950"
                              >
                                Lze upravit
                              </Badge>
                            )}
                            {dur > 0 ? (
                              <span className="text-xs font-semibold tabular-nums text-neutral-950">
                                Úsek {dur} h
                              </span>
                            ) : null}
                          </div>
                          <p className="text-base font-semibold text-neutral-950">{terminalLabel}</p>
                          <p className="text-sm text-neutral-900">{segmentTimeRangeLabel(seg)}</p>
                          {locked ? (
                            <p className="rounded-md border border-neutral-950 bg-white px-3 py-2 text-sm text-neutral-950">
                              Zakázka byla vybrána v terminálu – nelze upravit rozdělení času ani zakázku u
                              tohoto úseku.
                            </p>
                          ) : null}
                          <div
                            className={cn(
                              "mt-2 grid grid-cols-1 gap-3 rounded-lg border-2 px-3 py-3 text-sm sm:grid-cols-3",
                              over
                                ? "border-red-600 bg-red-50"
                                : "border-neutral-950 bg-white"
                            )}
                          >
                            <div>
                              <span className="font-medium text-neutral-950">Odpracováno (úsek)</span>
                              <p className="font-semibold tabular-nums text-neutral-950">
                                {dur > 0 ? `${dur} h` : "—"}
                              </p>
                            </div>
                            <div>
                              <span className="font-medium text-neutral-950">Rozděleno</span>
                              <p className="font-semibold tabular-nums text-neutral-950">{allocated} h</p>
                            </div>
                            <div>
                              <span className="font-medium text-neutral-950">Zbývá</span>
                              <p
                                className={cn(
                                  "font-semibold tabular-nums",
                                  remaining < -SPLIT_EPS && "text-red-700",
                                  !over &&
                                    remaining >= -SPLIT_EPS &&
                                    remaining <= SPLIT_EPS &&
                                    "text-neutral-950"
                                )}
                              >
                                {over ? "—" : `${remaining} h`}
                              </p>
                            </div>
                          </div>
                          {over ? (
                            <p className="text-sm font-medium text-red-700">
                              Součet řádků překračuje délku úseku — upravte hodiny.
                            </p>
                          ) : null}
                        </div>

                        <div className="space-y-3">
                          {rows.map((row) => (
                            <div
                              key={row.rowId}
                              className="flex flex-col gap-3 rounded-lg border-2 border-neutral-950 bg-white p-3 sm:flex-row sm:items-end sm:gap-3"
                            >
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <Label className="text-xs font-medium text-neutral-950">Zakázka *</Label>
                                <select
                                  className="flex h-11 min-h-[44px] w-full rounded-md border-2 border-neutral-950 bg-white px-3 text-sm text-neutral-950"
                                  value={row.jobId}
                                  onChange={(e) =>
                                    setSegmentSplitRows((prev) => {
                                      const list = [...(prev[seg.id] ?? [])];
                                      const i = list.findIndex((x) => x.rowId === row.rowId);
                                      if (i < 0) return prev;
                                      list[i] = { ...list[i], jobId: e.target.value };
                                      return { ...prev, [seg.id]: list };
                                    })
                                  }
                                  disabled={
                                    formLocked || jobsLoading || dailyWorkLogOff || locked
                                  }
                                >
                                  <option value="">— vyberte —</option>
                                  {jobOptions.map((j) => (
                                    <option key={j.id} value={j.id}>
                                      {j.name || j.id}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="w-full space-y-1.5 sm:w-32">
                                <Label className="text-xs font-medium text-neutral-950">Hodiny *</Label>
                                <Input
                                  inputMode="decimal"
                                  className="h-11 min-h-[44px] border-2 border-neutral-950 tabular-nums text-neutral-950"
                                  placeholder="např. 1,5"
                                  value={row.hoursStr}
                                  onChange={(e) =>
                                    setSegmentSplitRows((prev) => {
                                      const list = [...(prev[seg.id] ?? [])];
                                      const i = list.findIndex((x) => x.rowId === row.rowId);
                                      if (i < 0) return prev;
                                      list[i] = { ...list[i], hoursStr: e.target.value };
                                      return { ...prev, [seg.id]: list };
                                    })
                                  }
                                  disabled={formLocked || dailyWorkLogOff || locked}
                                />
                              </div>
                              <div className="flex shrink-0 gap-2 sm:pb-0.5">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 border-2 border-neutral-950 bg-white"
                                  disabled={
                                    formLocked ||
                                    dailyWorkLogOff ||
                                    locked ||
                                    rows.length <= 1
                                  }
                                  onClick={() =>
                                    setSegmentSplitRows((prev) => {
                                      const list = [...(prev[seg.id] ?? [])].filter(
                                        (x) => x.rowId !== row.rowId
                                      );
                                      return {
                                        ...prev,
                                        [seg.id]:
                                          list.length > 0
                                            ? list
                                            : [{ rowId: newSplitRowId(), jobId: "", hoursStr: "" }],
                                      };
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
                          className="mt-4 min-h-[44px] w-full border-2 border-neutral-950 bg-white text-neutral-950 hover:bg-neutral-100 sm:w-auto"
                          disabled={formLocked || dailyWorkLogOff || locked}
                          onClick={() =>
                            setSegmentSplitRows((prev) => {
                              const list = [...(prev[seg.id] ?? [])];
                              list.push({ rowId: newSplitRowId(), jobId: "", hoursStr: "" });
                              return { ...prev, [seg.id]: list };
                            })
                          }
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Přidat řádek
                        </Button>
                      </div>
                    );
                  })}
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
                  variant="secondary"
                  className="min-h-[44px] w-full border-2 border-neutral-950 bg-white text-neutral-950 hover:bg-neutral-100 sm:w-auto"
                  disabled={
                    saving ||
                    privileged ||
                    formLocked ||
                    dailyWorkLogOff ||
                    closedSegments.length === 0 ||
                    needsAssignedJobsForSave
                  }
                  onClick={() => void postReport("draft")}
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Uložit rozpracováno"}
                </Button>
                <Button
                  type="button"
                  className="min-h-[44px] w-full border-2 border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-800 sm:w-auto"
                  disabled={
                    saving ||
                    privileged ||
                    formLocked ||
                    dailyWorkLogOff ||
                    closedSegments.length === 0 ||
                    needsAssignedJobsForSave
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
