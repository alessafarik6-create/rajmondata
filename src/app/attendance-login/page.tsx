"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Banknote, Briefcase, Loader2, LogOut, Search } from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useFirebase } from "@/firebase";
import {
  buildTerminalActiveSegmentMapFromDocs,
  type TerminalActiveSegment,
} from "@/lib/terminal-active-segment";

const RETURN_TO_SELECTION_MS = 1500;

type EmployeeRow = {
  id: string;
  firstName: string;
  lastName: string;
  photoURL: string | null;
  inWork?: boolean;
  activeSegment?: TerminalActiveSegment | null;
};

type JobRow = { id: string; name: string };

type TariffRow = {
  id: string;
  name: string;
  hourlyRateCzk: number | null;
  color?: string | null;
  active: boolean;
};

type ActiveSegment = TerminalActiveSegment;

type Step = "select" | "pin" | "work";

const TERMINAL_STATUS_POLL_MS = 14_000;

function segmentDisplayTitle(seg: TerminalActiveSegment): string {
  if (seg.sourceType === "job") {
    const n = seg.jobName?.trim() || seg.displayName?.trim();
    return n || "Zakázka";
  }
  const n = seg.tariffName?.trim() || seg.displayName?.trim();
  return n || "Tarif";
}

function initials(first: string, last: string) {
  const a = first.trim().charAt(0);
  const b = last.trim().charAt(0);
  return (a + b).toUpperCase() || "?";
}

function employeeFullName(emp: Pick<EmployeeRow, "firstName" | "lastName">) {
  return `${emp.firstName} ${emp.lastName}`.trim() || "Zaměstnanec";
}

function employeeMatchesSearch(emp: EmployeeRow, raw: string) {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const forward = employeeFullName(emp).toLowerCase();
  const reverse = `${emp.lastName} ${emp.firstName}`.trim().toLowerCase();
  return forward.includes(q) || reverse.includes(q);
}

function segmentMatchesCard(seg: ActiveSegment | null, kind: "job" | "tariff", id: string): boolean {
  if (!seg) return false;
  if (kind === "job") return seg.sourceType === "job" && seg.jobId === id;
  return seg.sourceType === "tariff" && seg.tariffId === id;
}

function AttendanceLoginContent() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { firestore, areServicesAvailable } = useFirebase();
  const companyId = searchParams.get("companyId")?.trim() ?? "";
  const returnToSelectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [step, setStep] = useState<Step>("select");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  /** Realtime mapa otevřených úseků (Firestore); má prioritu před activeSegment z API. */
  const [liveOpenSegments, setLiveOpenSegments] = useState<
    Record<string, TerminalActiveSegment>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  const [selected, setSelected] = useState<EmployeeRow | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [tariffs, setTariffs] = useState<TariffRow[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobRow | null>(null);
  const [selectedTariff, setSelectedTariff] = useState<TariffRow | null>(null);
  const [activeSegment, setActiveSegment] = useState<ActiveSegment | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [actionSaving, setActionSaving] = useState(false);
  const [switching, setSwitching] = useState(false);

  const [sessionInWork, setSessionInWork] = useState<boolean | null>(null);
  /** Po úspěšné akci čekáme na návrat na výběr zaměstnance — blokace dvojkliku a interakce. */
  const [awaitingReturnToSelect, setAwaitingReturnToSelect] = useState(false);
  /** Filtr jmen na obrazovce výběru zaměstnance (terminál). */
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState("");

  useEffect(() => {
    return () => {
      if (returnToSelectTimerRef.current) {
        clearTimeout(returnToSelectTimerRef.current);
        returnToSelectTimerRef.current = null;
      }
    };
  }, []);

  const loadEmployees = useCallback(
    async (showSpinner = true) => {
      if (!companyId) return;
      if (showSpinner) setLoadingList(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `/api/attendance-login/employees?companyId=${encodeURIComponent(companyId)}`
        );
        const data = (await res.json().catch(() => ({}))) as {
          employees?: EmployeeRow[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Nepodařilo se načíst zaměstnance.");
        }
        const list = Array.isArray(data.employees) ? data.employees : [];
        setEmployees(list);
      } catch (e: unknown) {
        setLoadError(e instanceof Error ? e.message : "Chyba načtení.");
      } finally {
        if (showSpinner) setLoadingList(false);
      }
    },
    [companyId]
  );

  useEffect(() => {
    console.log("Attendance employee selection page loaded");
  }, []);

  useEffect(() => {
    if (!companyId) {
      setLoadingList(false);
      setLoadError("Chybí odkaz s ID firmy (companyId). Otevřete stránku z portálu.");
      return;
    }
    void loadEmployees(true);
  }, [companyId, loadEmployees]);

  useEffect(() => {
    if (!companyId || step !== "select") return;
    const id = window.setInterval(() => void loadEmployees(false), TERMINAL_STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [companyId, step, loadEmployees]);

  useEffect(() => {
    if (!companyId || !areServicesAvailable || !firestore) return;
    const todayIso = new Date().toISOString().split("T")[0];
    const q = query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("date", "==", todayIso),
      where("closed", "==", false)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const map = buildTerminalActiveSegmentMapFromDocs(snap.docs);
        const rec: Record<string, TerminalActiveSegment> = {};
        map.forEach((v, k) => {
          rec[k] = v;
        });
        setLiveOpenSegments(rec);
      },
      (err) => {
        console.error("[attendance-login] work_segments listener", err);
      }
    );
    return () => unsub();
  }, [companyId, areServicesAvailable, firestore]);

  const displayedEmployees = useMemo(() => {
    const filtered = employees.filter((e) => employeeMatchesSearch(e, employeeSearchQuery));
    return [...filtered].sort((a, b) => {
      const aWork = a.inWork === true ? 1 : 0;
      const bWork = b.inWork === true ? 1 : 0;
      if (bWork !== aWork) return bWork - aWork;
      const na = `${a.lastName} ${a.firstName}`.trim().toLowerCase();
      const nb = `${b.lastName} ${b.firstName}`.trim().toLowerCase();
      return na.localeCompare(nb, "cs");
    });
  }, [employees, employeeSearchQuery]);

  const resetToSelection = useCallback(
    (opts?: { afterAttendance?: boolean }) => {
      console.log("Resetting attendance login state");
      if (returnToSelectTimerRef.current) {
        clearTimeout(returnToSelectTimerRef.current);
        returnToSelectTimerRef.current = null;
      }
      setAwaitingReturnToSelect(false);
      setSelected(null);
      setPin("");
      setPinError(null);
      setJobs([]);
      setTariffs([]);
      setSelectedJob(null);
      setSelectedTariff(null);
      setActiveSegment(null);
      setSessionInWork(null);
      setStep("select");
      if (opts?.afterAttendance) {
        void loadEmployees(false);
      }
    },
    [loadEmployees]
  );

  /** Po úspěšné akci: potvrzení a návrat na výběr zaměstnance (připraveno pro dalšího člověka). */
  const scheduleReturnToSelection = useCallback(
    (payload: {
      title: string;
      description?: string;
      afterAttendance?: boolean;
      delayMs?: number;
    }) => {
      toast({
        title: payload.title,
        description:
          payload.description ??
          `Za ${Math.round((payload.delayMs ?? RETURN_TO_SELECTION_MS) / 100) / 10} s se terminál vrátí na výběr zaměstnance.`,
      });
      setAwaitingReturnToSelect(true);
      if (returnToSelectTimerRef.current) {
        clearTimeout(returnToSelectTimerRef.current);
      }
      const delay = payload.delayMs ?? RETURN_TO_SELECTION_MS;
      returnToSelectTimerRef.current = setTimeout(() => {
        returnToSelectTimerRef.current = null;
        resetToSelection({ afterAttendance: payload.afterAttendance !== false });
      }, delay);
    },
    [resetToSelection, toast]
  );

  const selectEmployee = useCallback((emp: EmployeeRow) => {
    console.log("Employee selected");
    setSelected(emp);
    setPin("");
    setPinError(null);
    setStep("pin");
  }, []);

  const goBack = () => {
    setPinError(null);
    if (step === "pin") {
      setSelected(null);
      setPin("");
      setStep("select");
    } else if (step === "work") {
      resetToSelection();
    }
  };

  const appendDigit = (d: string) => {
    if (pin.length >= 12) return;
    setPin((p) => p + d);
    setPinError(null);
  };

  const backspace = () => {
    setPin((p) => p.slice(0, -1));
    setPinError(null);
  };

  const applyJobsResponse = useCallback(
    (
      jd: { jobs?: JobRow[]; tariffs?: TariffRow[] },
      jrOk: boolean,
      segFromVerify: ActiveSegment | null
    ) => {
      if (jrOk && Array.isArray(jd.jobs)) {
        const tlist = Array.isArray(jd.tariffs) ? jd.tariffs : [];
        setJobs(jd.jobs);
        setTariffs(tlist);
        if (segFromVerify) {
          if (segFromVerify.sourceType === "job" && segFromVerify.jobId) {
            const j = jd.jobs.find((x) => x.id === segFromVerify.jobId);
            if (j) {
              setSelectedJob(j);
              setSelectedTariff(null);
            } else {
              setSelectedJob(null);
              setSelectedTariff(null);
            }
          } else if (segFromVerify.sourceType === "tariff" && segFromVerify.tariffId) {
            const t = tlist.find((x) => x.id === segFromVerify.tariffId);
            if (t) {
              setSelectedTariff(t);
              setSelectedJob(null);
            } else {
              setSelectedJob(null);
              setSelectedTariff(null);
            }
          } else {
            setSelectedJob(null);
            setSelectedTariff(null);
          }
        } else {
          setSelectedJob(null);
          setSelectedTariff(null);
        }
      } else {
        setJobs([]);
        setTariffs([]);
        setSelectedJob(null);
        setSelectedTariff(null);
      }
    },
    []
  );

  const submitPin = async () => {
    if (!companyId || !selected) return;
    if (!pin.trim()) {
      setPinError("Zadejte PIN.");
      return;
    }
    setVerifying(true);
    setPinError(null);
    let segFromVerify: ActiveSegment | null = null;
    try {
      const res = await fetch("/api/attendance-login/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          employeeId: selected.id,
          pin,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        inWork?: boolean;
        activeSegment?: ActiveSegment | null;
      };
      if (!res.ok || !data.ok) {
        setPinError(typeof data.error === "string" ? data.error : "Neplatný PIN");
        return;
      }
      const inW = data.inWork === true;
      setSessionInWork(inW);
      segFromVerify =
        data.activeSegment &&
        typeof data.activeSegment === "object" &&
        (data.activeSegment.sourceType === "job" || data.activeSegment.sourceType === "tariff")
          ? data.activeSegment
          : null;
      setActiveSegment(segFromVerify);

      console.log(`Employee status resolved: ${inW ? "in work" : "out of work"} (${selected.id})`);

      setStep("work");
      setVerifying(false);
      setJobsLoading(true);
      setJobs([]);
      setTariffs([]);

      try {
        const jr = await fetch("/api/attendance-login/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            employeeId: selected.id,
            pin,
          }),
        });
        const jd = (await jr.json().catch(() => ({}))) as {
          jobs?: JobRow[];
          tariffs?: TariffRow[];
        };
        applyJobsResponse(jd, jr.ok, segFromVerify);
      } catch {
        toast({
          variant: "destructive",
          title: "Zakázky se nepodařilo načíst",
          description: "Můžete zkusit příchod bez výběru, nebo se odhlásit a zadat PIN znovu.",
        });
        setJobs([]);
        setTariffs([]);
        setSelectedJob(null);
        setSelectedTariff(null);
      } finally {
        setJobsLoading(false);
      }
    } catch {
      setPinError("Ověření se nezdařilo.");
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    if (step !== "work" || sessionInWork === null) return;
    if (sessionInWork) {
      console.log("Showing check-out action");
    } else {
      console.log("Showing check-in action");
    }
  }, [step, sessionInWork]);

  const postAttendance = async (action: "check-in" | "check-out") => {
    if (!companyId || !selected) return;
    setActionSaving(true);
    try {
      const body: Record<string, unknown> = {
        companyId,
        employeeId: selected.id,
        pin,
        action,
        employeeName: `${selected.firstName} ${selected.lastName}`.trim(),
      };
      if (action === "check-in") {
        if (selectedJob) {
          body.sourceType = "job";
          body.jobId = selectedJob.id;
          body.jobName = selectedJob.name;
        } else if (selectedTariff) {
          body.sourceType = "tariff";
          body.tariffId = selectedTariff.id;
          body.tariffName = selectedTariff.name;
        }
      }
      const res = await fetch("/api/attendance-login/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        activeSegment?: ActiveSegment | null;
      };
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Uložení se nezdařilo",
          description:
            typeof data.error === "string" ? data.error : "Zkuste to znovu nebo kontaktujte administrátora.",
        });
        return;
      }
      console.log("Attendance saved");
      if (action === "check-in") {
        scheduleReturnToSelection({
          title: "Příchod zaznamenán",
          description: "Uloženo. Terminál se vrací na výběr zaměstnance.",
          afterAttendance: true,
        });
      } else {
        scheduleReturnToSelection({
          title: "Odchod zaznamenán",
          description: "Uloženo. Terminál se vrací na výběr zaměstnance.",
          afterAttendance: true,
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: "Zkontrolujte připojení a zkuste to znovu.",
      });
    } finally {
      setActionSaving(false);
    }
  };

  const endActiveSegment = async () => {
    if (!companyId || !selected) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/attendance-login/end-segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          employeeId: selected.id,
          pin,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Ukončení se nezdařilo",
          description:
            typeof data.error === "string" ? data.error : "Zkuste to znovu nebo kontaktujte administrátora.",
        });
        return;
      }
      scheduleReturnToSelection({
        title: "Uloženo",
        description: "Práce na zakázce / tarifu byla ukončena. Terminál se vrací na výběr zaměstnance.",
        afterAttendance: true,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Ukončení se nezdařilo",
        description: "Zkontrolujte připojení a zkuste to znovu.",
      });
    } finally {
      setSwitching(false);
    }
  };

  const switchSegment = async (kind: "job" | "tariff", row: JobRow | TariffRow) => {
    if (!companyId || !selected || !sessionInWork) return;
    if (segmentMatchesCard(activeSegment, kind, row.id)) return;
    setSwitching(true);
    try {
      const body: Record<string, unknown> = {
        companyId,
        employeeId: selected.id,
        pin,
        sourceType: kind,
      };
      if (kind === "job") {
        body.jobId = row.id;
        body.jobName = row.name;
      } else {
        body.tariffId = row.id;
        body.tariffName = row.name;
      }
      const res = await fetch("/api/attendance-login/switch-segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        activeSegment?: ActiveSegment;
      };
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Přepnutí se nezdařilo",
          description:
            typeof data.error === "string" ? data.error : "Zkuste to znovu nebo kontaktujte administrátora.",
        });
        return;
      }
      const seg = data.activeSegment;
      const segLabel =
        seg?.displayName ||
        (kind === "job" ? (row as JobRow).name : (row as TariffRow).name);
      scheduleReturnToSelection({
        title: "Zaznamenáno",
        description: segLabel
          ? `Úsek „${segLabel}“ byl uložen. Terminál se vrací na výběr zaměstnance.`
          : "Úsek byl uložen. Terminál se vrací na výběr zaměstnance.",
        afterAttendance: true,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Přepnutí se nezdařilo",
        description: "Zkontrolujte připojení a zkuste to znovu.",
      });
    } finally {
      setSwitching(false);
    }
  };

  const fullName = selected
    ? `${selected.firstName} ${selected.lastName}`.trim() || "Zaměstnanec"
    : "";

  const hasChoice = jobs.length > 0 || tariffs.length > 0;
  const canCheckOut = true;

  const pickJob = (j: JobRow) => {
    if (sessionInWork) {
      void switchSegment("job", j);
      return;
    }
    console.log("Employee selected job", { jobId: j.id });
    setSelectedJob(j);
    setSelectedTariff(null);
  };

  const pickTariff = (t: TariffRow) => {
    if (sessionInWork) {
      void switchSegment("tariff", t);
      return;
    }
    console.log("Employee selected tariff", { tariffId: t.id });
    setSelectedTariff(t);
    setSelectedJob(null);
  };

  return (
    <div
      className={cn(
        "mx-auto flex min-h-dvh flex-col px-3 pb-8 pt-3 sm:px-4 sm:pt-4",
        step === "select"
          ? "max-w-[1600px]"
          : "max-w-2xl px-4 py-8 pb-12 sm:px-6"
      )}
    >
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-2",
          step === "select" ? "mb-2 sm:h-9 sm:mb-3" : "mb-8"
        )}
      >
        {step !== "select" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2 text-slate-300 hover:bg-white/10 hover:text-white"
            disabled={awaitingReturnToSelect}
            onClick={goBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Zpět
          </Button>
        ) : (
          <span className="w-12 shrink-0 sm:w-16" aria-hidden />
        )}
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[10px] font-medium uppercase tracking-widest text-emerald-400/90 sm:text-xs">
            Docházka
          </p>
          <h1
            className={cn(
              "truncate font-semibold tracking-tight text-white",
              step === "select" ? "text-sm sm:text-base" : "text-lg sm:text-xl"
            )}
          >
            {step === "select" ? "Vyberte profil" : "Přihlášení zaměstnance"}
          </h1>
        </div>
        {step === "work" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2 text-slate-300 hover:bg-white/10 hover:text-white"
            disabled={awaitingReturnToSelect}
            onClick={() => resetToSelection()}
          >
            <LogOut className="h-4 w-4" />
            Zrušit
          </Button>
        ) : (
          <span className="w-12 shrink-0 sm:w-16" aria-hidden />
        )}
      </header>

      {!companyId && (
        <Card className="border-amber-500/35 bg-amber-950/30">
          <CardContent className="p-4 text-sm text-amber-100">{loadError}</CardContent>
        </Card>
      )}

      {companyId && loadError && (
        <Card className="border-red-500/35 bg-red-950/30">
          <CardContent className="p-4 text-sm text-red-100">{loadError}</CardContent>
        </Card>
      )}

      {companyId && !loadError && step === "select" && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {loadingList ? (
            <div className="flex flex-1 items-center justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-500/60 sm:h-12 sm:w-12" />
            </div>
          ) : employees.length === 0 ? (
            <p className="text-center text-slate-500">Žádní aktivní zaměstnanci.</p>
          ) : (
            <>
              <div className="sticky top-0 z-20 -mx-3 shrink-0 border-b border-white/10 bg-slate-950/90 px-3 py-2 backdrop-blur-md sm:-mx-4 sm:px-4">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    value={employeeSearchQuery}
                    onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                    placeholder="Hledat podle jména…"
                    autoComplete="off"
                    className="h-10 min-h-[44px] border-white/20 bg-black/35 pl-9 text-sm text-white placeholder:text-slate-500 focus-visible:ring-emerald-500/40"
                  />
                </div>
                <p className="mt-1.5 text-center text-[10px] leading-tight text-slate-500 sm:text-[11px]">
                  {displayedEmployees.length === employees.length ? (
                    <>
                      {employees.length} zaměstnanců · <span className="text-emerald-400/90">v práci nahoře</span>
                    </>
                  ) : (
                    <>
                      Zobrazeno {displayedEmployees.length} z {employees.length}
                      {employeeSearchQuery.trim() ? ` · „${employeeSearchQuery.trim()}“` : ""}
                    </>
                  )}
                </p>
              </div>

              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {displayedEmployees.map((emp) => {
                  const inWork = emp.inWork === true;
                  const seg = liveOpenSegments[emp.id] ?? emp.activeSegment ?? null;
                  const showAssigned = inWork === true && seg != null;
                  const nameTitle = employeeFullName(emp);
                  return (
                    <li key={emp.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => selectEmployee(emp)}
                        title={nameTitle}
                        className={cn(
                          "flex w-full min-h-[88px] items-stretch gap-2 rounded-xl border-2 p-2 text-left shadow-md transition sm:min-h-[92px] sm:gap-2.5 sm:p-2.5",
                          "touch-manipulation active:scale-[0.98]",
                          inWork
                            ? "border-emerald-400/85 bg-gradient-to-br from-emerald-900/45 via-emerald-950/35 to-slate-950/95 ring-1 ring-emerald-500/35"
                            : "border-rose-500/70 bg-gradient-to-br from-rose-950/40 via-slate-900/55 to-slate-950/95 ring-1 ring-rose-500/25"
                        )}
                      >
                        <Avatar
                          className={cn(
                            "h-12 w-12 shrink-0 border-2 shadow sm:h-14 sm:w-14",
                            inWork ? "border-emerald-300/55" : "border-rose-300/45"
                          )}
                        >
                          {emp.photoURL ? (
                            <AvatarImage src={emp.photoURL} alt="" className="object-cover" />
                          ) : null}
                          <AvatarFallback
                            className={cn(
                              "text-sm font-semibold text-white sm:text-base",
                              inWork ? "bg-emerald-800" : "bg-rose-900"
                            )}
                          >
                            {initials(emp.firstName, emp.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                          <div className="flex items-start justify-between gap-1">
                            <span className="line-clamp-2 min-h-[2.25rem] text-[13px] font-semibold leading-tight text-white sm:min-h-[2.5rem] sm:text-sm">
                              {emp.firstName} {emp.lastName}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase leading-none sm:text-[10px]",
                                inWork
                                  ? "bg-emerald-500 text-white"
                                  : "bg-rose-600 text-white"
                              )}
                            >
                              {inWork ? "Práce" : "Mimo"}
                            </span>
                          </div>
                          {showAssigned ? (
                            <div
                              className="flex min-w-0 items-center gap-1 text-[10px] font-medium leading-tight text-emerald-100/95 sm:text-[11px]"
                              title={`${seg.sourceType === "job" ? "Na zakázce" : "Tarif"}: ${segmentDisplayTitle(seg)}`}
                            >
                              {seg.sourceType === "job" ? (
                                <Briefcase className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden />
                              ) : (
                                <Banknote className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden />
                              )}
                              <span className="truncate">
                                {seg.sourceType === "job" ? "Zák.: " : "Tarif: "}
                                {segmentDisplayTitle(seg)}
                              </span>
                            </div>
                          ) : (
                            <span className="truncate text-[10px] text-slate-500 sm:text-[11px]">
                              Nepřiřazen
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {displayedEmployees.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  Žádný zaměstnanec neodpovídá hledání.
                </p>
              ) : null}
            </>
          )}
        </div>
      )}

      {companyId && step === "pin" && selected && (
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8">
          <div className="flex flex-col items-center gap-3">
            <Avatar className="h-24 w-24 border-2 border-white/15 shadow-lg">
              {selected.photoURL ? (
                <AvatarImage src={selected.photoURL} alt="" className="object-cover" />
              ) : null}
              <AvatarFallback className="bg-slate-700 text-2xl font-semibold text-white">
                {initials(selected.firstName, selected.lastName)}
              </AvatarFallback>
            </Avatar>
            <p className="text-xl font-semibold text-white">{fullName}</p>
            <p className="text-sm text-slate-400">Zadejte PIN</p>
          </div>

          <Card className="border-white/10 bg-black/25 shadow-inner">
            <CardContent className="px-4 py-6 text-center font-mono text-3xl tracking-[0.35em] text-white sm:text-4xl">
              {pin ? pin.replace(/./g, "•") : <span className="text-slate-600">••••</span>}
            </CardContent>
          </Card>

          {pinError && <p className="text-center text-sm text-red-400">{pinError}</p>}

          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
              k === "" ? (
                <span key={`e-${i}`} />
              ) : (
                <Button
                  key={k}
                  type="button"
                  variant="secondary"
                  className="h-16 rounded-2xl text-2xl font-semibold shadow-md sm:h-[4.25rem]"
                  onClick={() => (k === "⌫" ? backspace() : appendDigit(k))}
                >
                  {k}
                </Button>
              )
            )}
          </div>

          <Button
            type="button"
            size="lg"
            className="h-14 rounded-2xl text-lg font-semibold shadow-lg"
            disabled={verifying || !pin}
            onClick={() => void submitPin()}
          >
            {verifying ? <Loader2 className="h-7 w-7 animate-spin" /> : "Potvrdit PIN"}
          </Button>
        </div>
      )}

      {companyId && step === "work" && selected && sessionInWork !== null && (
        <div className="relative flex flex-1 flex-col gap-8">
          {awaitingReturnToSelect ? (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-slate-950/80 px-6 text-center backdrop-blur-sm"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
              <p className="text-base font-medium text-white">Návrat na výběr zaměstnance…</p>
              <p className="text-sm text-slate-400">Počkejte prosím chvíli.</p>
            </div>
          ) : null}
          <Card
            className={cn(
              "overflow-hidden border-2 shadow-xl",
              sessionInWork
                ? "border-emerald-400/80 bg-gradient-to-br from-emerald-600/25 via-emerald-900/30 to-slate-950"
                : "border-rose-500/70 bg-gradient-to-br from-rose-900/35 via-slate-900/50 to-slate-950"
            )}
          >
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
                <Avatar
                  className={cn(
                    "h-20 w-20 border-2 shadow-md",
                    sessionInWork ? "border-emerald-400/70" : "border-rose-400/60"
                  )}
                >
                  {selected.photoURL ? (
                    <AvatarImage src={selected.photoURL} alt="" className="object-cover" />
                  ) : null}
                  <AvatarFallback
                    className={cn(
                      "text-2xl font-bold text-white",
                      sessionInWork ? "bg-emerald-800" : "bg-rose-900"
                    )}
                  >
                    {initials(selected.firstName, selected.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="text-center sm:text-left">
                  <Badge
                    className={cn(
                      "mb-2 font-semibold",
                      sessionInWork
                        ? "bg-emerald-500 text-white hover:bg-emerald-500"
                        : "bg-rose-600 text-white hover:bg-rose-600"
                    )}
                  >
                    {sessionInWork ? "V práci" : "Mimo práci"}
                  </Badge>
                  <p className="text-xl font-bold tracking-tight text-white sm:text-2xl">{fullName}</p>
                  <p className="mt-1 text-sm text-slate-300">
                    {sessionInWork
                      ? "Směna běží — níže přepněte zakázku / tarif nebo zaznamenejte odchod."
                      : "Níže zvolte zakázku nebo tarif (volitelné) a zaznamenejte příchod."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {sessionInWork && activeSegment && (
            <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-center sm:text-left">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Aktuálně</p>
              <p className="text-lg font-semibold text-white">{activeSegment.displayName}</p>
              <p className="text-xs text-slate-500">
                {activeSegment.sourceType === "job" ? "Zakázka" : "Interní tarif"}
              </p>
            </div>
          )}

          {sessionInWork && activeSegment && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-center text-sm text-slate-300 sm:text-left">
                Ukončíte jen práci na zakázce / tarifu — směna zůstane otevřená.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="h-12 min-h-[44px] shrink-0 rounded-xl border-amber-400/40 bg-amber-950/40 text-amber-foreground hover:bg-amber-900/50"
                disabled={switching || actionSaving || awaitingReturnToSelect}
                onClick={() => void endActiveSegment()}
              >
                {switching ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Ukončit práci na zakázce / tarifu"
                )}
              </Button>
            </div>
          )}

          {jobsLoading ? (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-8">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-500/70" />
              <p className="text-sm text-slate-400">Načítám zakázky a tarify…</p>
            </div>
          ) : hasChoice ? (
            <div className="space-y-4">
              <p className="text-center text-sm font-medium text-slate-200">
                {sessionInWork ? "Na čem právě pracujete" : "Zakázka nebo interní tarif (volitelné)"}
              </p>
              {sessionInWork ? (
                <p className="text-center text-xs text-slate-500">
                  Klepnutím přepnete úsek — směna zůstane otevřená. Nebo ukončete aktivní zakázku / tarif
                  výše.
                </p>
              ) : (
                <p className="text-center text-xs text-slate-500">
                  Vyberte úsek před příchodem, nebo klepněte na „Příchod do práce“ dole bez výběru.
                </p>
              )}

              {jobs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Zakázky</p>
                  <div className="grid max-h-[min(32vh,280px)] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {jobs.map((j) => {
                      const activeCard =
                        sessionInWork && segmentMatchesCard(activeSegment, "job", j.id);
                      const selectedBefore =
                        !sessionInWork && selectedJob?.id === j.id;
                      return (
                        <button
                          key={j.id}
                          type="button"
                          disabled={switching || actionSaving || awaitingReturnToSelect}
                          onClick={() => pickJob(j)}
                          className={cn(
                            "min-h-[52px] rounded-2xl border px-4 py-4 text-left text-base font-medium transition",
                            activeCard || selectedBefore
                              ? "border-emerald-400/90 bg-emerald-500/25 text-white shadow-md"
                              : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                          )}
                        >
                          {j.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {tariffs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Interní tarify
                  </p>
                  <div className="grid max-h-[min(28vh,240px)] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {tariffs.map((t) => {
                      const activeCard =
                        sessionInWork && segmentMatchesCard(activeSegment, "tariff", t.id);
                      const selectedBefore =
                        !sessionInWork && selectedTariff?.id === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={switching || actionSaving || awaitingReturnToSelect}
                          onClick={() => pickTariff(t)}
                          className={cn(
                            "min-h-[52px] rounded-2xl border px-4 py-4 text-left text-base font-medium transition",
                            activeCard || selectedBefore
                              ? "border-amber-400/90 bg-amber-500/20 text-white shadow-md"
                              : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                          )}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(switching || actionSaving || awaitingReturnToSelect) && (
                <p className="text-center text-xs text-slate-400">
                  {awaitingReturnToSelect
                    ? "Ukládám a vracím terminál…"
                    : switching
                      ? "Přepínám…"
                      : "Ukládám…"}
                </p>
              )}
            </div>
          ) : (
            <p className="text-center text-sm text-slate-400">
              {sessionInWork
                ? "Žádné zakázky ani tarify k výběru — jste v práci bez zakázkového úseku. Po přiřazení v administraci se zobrazí zde."
                : "Žádné zakázky ani tarify k výběru — můžete zaznamenat příchod bez úseku."}
            </p>
          )}

          <div className="mt-auto pt-2">
            {!sessionInWork ? (
              <Button
                type="button"
                size="lg"
                className="h-16 min-h-[56px] w-full rounded-2xl bg-emerald-600 text-lg font-semibold shadow-lg hover:bg-emerald-500"
                disabled={actionSaving || awaitingReturnToSelect}
                onClick={() => void postAttendance("check-in")}
              >
                {actionSaving ? <Loader2 className="h-6 w-6 animate-spin" /> : "Příchod do práce"}
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                className="h-16 min-h-[56px] w-full rounded-2xl border border-rose-400/50 bg-rose-700 text-lg font-semibold text-white shadow-lg hover:bg-rose-600"
                disabled={actionSaving || !canCheckOut || awaitingReturnToSelect}
                onClick={() => void postAttendance("check-out")}
              >
                {actionSaving ? <Loader2 className="h-6 w-6 animate-spin" /> : "Odchod z práce"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AttendanceLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-emerald-500/60" />
        </div>
      }
    >
      <AttendanceLoginContent />
    </Suspense>
  );
}
