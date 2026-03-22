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
  const [jobId, setJobId] = useState("");
  const [hoursConfirmed, setHoursConfirmed] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existingReport) {
      setDescription(String(existingReport.description ?? ""));
      setNote(String(existingReport.note ?? ""));
      setJobId(typeof existingReport.jobId === "string" ? existingReport.jobId : "");
      setHoursConfirmed(
        typeof existingReport.hoursConfirmed === "number"
          ? String(existingReport.hoursConfirmed)
          : ""
      );
      return;
    }
    setDescription("");
    setNote("");
    setJobId("");
    const h = daySummary?.hoursWorked;
    setHoursConfirmed(h != null ? String(h) : "");
  }, [existingReport, dayKey, daySummary?.hoursWorked]);

  const submit = async () => {
    if (!user || !companyId || !dayKey) return;
    if (privileged) {
      toast({
        variant: "destructive",
        title: "Nelze uložit",
        description: "Denní výkaz ukládají zaměstnanci — použijte účet s rolí zaměstnanec.",
      });
      return;
    }
    if (!description.trim()) {
      toast({ variant: "destructive", title: "Chybí popis", description: "Vyplňte, co jste dělali." });
      return;
    }
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const job = assignedJobs.find((j) => j.id === jobId);
      const hNum = Number(hoursConfirmed.replace(",", "."));
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
          jobId: jobId || null,
          jobName: job?.name ?? null,
          hoursFromAttendance:
            typeof daySummary?.hoursWorked === "number" ? daySummary.hoursWorked : null,
          hoursConfirmed: Number.isFinite(hNum) ? hNum : null,
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
      toast({ title: t("saved"), description: "Denní výkaz byl odeslán ke schválení." });
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
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Výkaz za den</CardTitle>
                <CardDescription>Popište vykonanou práci — odesláním požádáte o schválení</CardDescription>
              </div>
              {status ? (
                <Badge
                  className={cn(
                    status === "approved" && "bg-emerald-600",
                    status === "pending" && "bg-amber-500",
                    status === "rejected" && "bg-red-600"
                  )}
                >
                  {status === "approved"
                    ? "Schváleno"
                    : status === "pending"
                      ? "Čeká na schválení"
                      : "Zamítnuto"}
                </Badge>
              ) : reportLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {assignedJobs.length > 0 ? (
                <div className="space-y-2">
                  <Label>Zakázka</Label>
                  <select
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value)}
                    disabled={status === "approved" || jobsLoading}
                  >
                    <option value="">— volitelně —</option>
                    {assignedJobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name || j.id}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="dr-hours">Potvrzené hodiny (volitelné)</Label>
                <input
                  id="dr-hours"
                  type="text"
                  inputMode="decimal"
                  className="flex h-11 w-full max-w-[12rem] rounded-md border border-input bg-background px-3 text-sm tabular-nums"
                  value={hoursConfirmed}
                  onChange={(e) => setHoursConfirmed(e.target.value)}
                  disabled={status === "approved"}
                  placeholder="např. 8"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dr-desc">Co jste dělali *</Label>
                <Textarea
                  id="dr-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={status === "approved"}
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
                  disabled={status === "approved"}
                  rows={2}
                />
              </div>

              <Button
                type="button"
                className="min-h-[44px] w-full sm:w-auto"
                disabled={saving || privileged || status === "approved"}
                onClick={() => void submit()}
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : t("save")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
