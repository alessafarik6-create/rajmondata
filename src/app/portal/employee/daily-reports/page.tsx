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
import { Loader2, AlertCircle } from "lucide-react";
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
  segmentTimeRangeLabel,
  sortSegmentsByStart,
} from "@/lib/work-segment-client";

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
  /** segmentId → jobId pro uzavřené úseky z terminálu */
  const [segmentJobById, setSegmentJobById] = useState<Record<string, string>>({});
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
    const next: Record<string, string> = {};
    const alloc = existingReport?.segmentAllocations;
    if (Array.isArray(alloc)) {
      for (const a of alloc as { segmentId?: string; jobId?: string }[]) {
        const sid = String(a.segmentId || "").trim();
        const jid = String(a.jobId || "").trim();
        if (sid && jid) next[sid] = jid;
      }
    }
    const legacyJob =
      typeof existingReport?.jobId === "string" ? existingReport.jobId.trim() : "";
    for (const seg of closedSegments) {
      if (!next[seg.id] && legacyJob) next[seg.id] = legacyJob;
      if (!next[seg.id]) next[seg.id] = "";
    }
    setSegmentJobById(next);
  }, [existingReport, dayKey, closedSegmentIdsKey]);

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
    for (const seg of closedSegments) {
      const jid = String(segmentJobById[seg.id] || "").trim();
      if (!jid) {
        toast({
          variant: "destructive",
          title: "Chybí zakázka",
          description: "U každého úseku z docházky vyberte zakázku z vašeho přiřazení.",
        });
        return;
      }
    }
    if (mode === "submit" && !description.trim()) {
      toast({ variant: "destructive", title: "Chybí popis", description: "Vyplňte, co jste dělali." });
      return;
    }
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const segmentAllocations = closedSegments.map((seg) => ({
        segmentId: seg.id,
        jobId: String(segmentJobById[seg.id] || "").trim(),
      }));
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
          segmentAllocations,
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">Denní výkaz práce</h1>
        <p className="portal-page-description mt-1">
          Ke každému dni doplňte popis práce — navazuje na docházku (příchod / odchod).{" "}
          {companyName ? <span className="font-semibold text-slate-800">{companyName}</span> : null}
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Den</CardTitle>
            <CardDescription>Vyberte pracovní den</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-2">
            <Calendar
              mode="single"
              selected={selectedDay}
              onSelect={(d) => d && setSelectedDay(d)}
              locale={cs}
              className="rounded-md border"
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Docházka pro {dayKey}</CardTitle>
              <CardDescription>Shrnutí záznamů příchodu a odchodu</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {attendanceLoading ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Načítám…
                </p>
              ) : daySummary ? (
                <>
                  <p>
                    <span className="text-muted-foreground">Příchod:</span>{" "}
                    {daySummary.checkIn ?? "—"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Odchod:</span>{" "}
                    {daySummary.checkOut ?? "—"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Odpracováno (odhad):</span>{" "}
                    <span className="font-semibold tabular-nums">
                      {daySummary.hoursWorked != null ? `${daySummary.hoursWorked} h` : "—"}
                    </span>
                  </p>
                  <p className="text-muted-foreground">{daySummary.statusLabel}</p>
                </>
              ) : (
                <p className="text-muted-foreground">Pro tento den nejsou záznamy docházky.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Úseky práce (zakázky / tarify)</CardTitle>
              <CardDescription>
                Evidence z docházky — částky jsou orientační do schválení výkazu administrátorem.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {segmentsLoading ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Načítám segmenty…
                </p>
              ) : closedSegments.length === 0 ? (
                <p className="text-muted-foreground">
                  Žádné uzavřené úseky z terminálu za tento den — bez nich nelze sestavit denní výkaz.
                </p>
              ) : (
                <ul className="space-y-2">
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
                        className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40"
                      >
                        <div>
                          <span className="text-xs font-medium text-muted-foreground">{st}</span>
                          <p className="font-medium text-slate-900 dark:text-slate-100">{name}</p>
                          <p className="text-xs text-muted-foreground">{segmentTimeRangeLabel(seg)}</p>
                        </div>
                        <div className="text-right text-xs tabular-nums">
                          <p>{h}</p>
                          <p className="text-muted-foreground">{amt}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {typeof existingReport?.estimatedLaborFromSegmentsCzk === "number" &&
                existingReport.estimatedLaborFromSegmentsCzk > 0 && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    Odhad z uzavřených segmentů (výkaz):{" "}
                    <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                      {formatKc(existingReport.estimatedLaborFromSegmentsCzk)}
                    </span>
                  </p>
                )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Výkaz za den</CardTitle>
                <CardDescription>Popište vykonanou práci — odesláním požádáte o schválení</CardDescription>
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
                    <span className="text-xs font-medium text-emerald-800">
                      Částka k výplatě: {formatKc(existingReport.payableAmountCzk as number)}
                    </span>
                  ) : null}
                </div>
              ) : reportLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Hodiny výkazu se počítají z uzavřených úseků docházky. U každého úseku zvolte{" "}
                <strong>zakázku</strong> z přiřazení administrátorem.
              </p>

              {segmentsLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Načítám úseky…
                </p>
              ) : closedSegments.length === 0 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  Pro tento den nejsou žádné uzavřené úseky z docházkového terminálu. Výkaz nelze uložit,
                  dokud nebudou k dispozici uzavřené segmenty (příchod / výběr činnosti / odchod).
                </p>
              ) : assignedJobs.length === 0 ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                  Nemáte přiřazenou žádnou zakázku pro výkaz. Požádejte administrátora o přiřazení zakázek.
                </p>
              ) : (
                <div className="space-y-3">
                  {closedSegments.map((seg) => {
                    const st = seg.sourceType === "tariff" ? "Tarif" : "Zakázka";
                    const terminalLabel =
                      typeof seg.displayName === "string"
                        ? seg.displayName
                        : String(seg.jobName || seg.tariffName || "Úsek");
                    return (
                      <div
                        key={seg.id}
                        className="rounded-md border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/30"
                      >
                        <div className="mb-2 text-xs text-muted-foreground">
                          {st} · {segmentTimeRangeLabel(seg)}
                          {typeof seg.durationHours === "number" ? ` · ${seg.durationHours} h` : ""}
                        </div>
                        <p className="mb-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                          {terminalLabel}
                        </p>
                        <Label className="text-xs">Zakázka ve výkazu *</Label>
                        <select
                          className="mt-1 flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={segmentJobById[seg.id] ?? ""}
                          onChange={(e) =>
                            setSegmentJobById((prev) => ({
                              ...prev,
                              [seg.id]: e.target.value,
                            }))
                          }
                          disabled={formLocked || jobsLoading || dailyWorkLogOff}
                        >
                          <option value="">— vyberte zakázku —</option>
                          {assignedJobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {j.name || j.id}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="dr-desc">Co jste dělali {status !== "draft" && !formLocked ? "*" : ""}</Label>
                <Textarea
                  id="dr-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={formLocked}
                  rows={4}
                  placeholder="Stručný popis úkolů…"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dr-note">Poznámka</Label>
                <Textarea
                  id="dr-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={formLocked}
                  rows={2}
                />
              </div>

              {status === "pending" ? (
                <p className="text-sm text-amber-800">
                  Výkaz čeká na schválení. Úpravy nejsou možné, dokud ho administrátor nevrátí nebo
                  nezamítne.
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-[44px] w-full sm:w-auto"
                  disabled={
                    saving ||
                    privileged ||
                    formLocked ||
                    dailyWorkLogOff ||
                    closedSegments.length === 0 ||
                    assignedJobs.length === 0
                  }
                  onClick={() => void postReport("draft")}
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Uložit rozpracováno"}
                </Button>
                <Button
                  type="button"
                  className="min-h-[44px] w-full sm:w-auto"
                  disabled={
                    saving ||
                    privileged ||
                    formLocked ||
                    dailyWorkLogOff ||
                    closedSegments.length === 0 ||
                    assignedJobs.length === 0
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
