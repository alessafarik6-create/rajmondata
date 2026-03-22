"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type EmployeeRow = {
  id: string;
  firstName: string;
  lastName: string;
  photoURL: string | null;
  inWork?: boolean;
};

type JobRow = { id: string; name: string };

type TariffRow = {
  id: string;
  name: string;
  hourlyRateCzk: number | null;
  color?: string | null;
  active: boolean;
};

type ActiveSegment = {
  sourceType: "job" | "tariff";
  jobId: string | null;
  jobName: string;
  tariffId: string | null;
  tariffName: string;
  displayName: string;
};

type Step = "select" | "pin" | "work";

function initials(first: string, last: string) {
  const a = first.trim().charAt(0);
  const b = last.trim().charAt(0);
  return (a + b).toUpperCase() || "?";
}

function segmentMatchesCard(seg: ActiveSegment | null, kind: "job" | "tariff", id: string): boolean {
  if (!seg) return false;
  if (kind === "job") return seg.sourceType === "job" && seg.jobId === id;
  return seg.sourceType === "tariff" && seg.tariffId === id;
}

function AttendanceLoginContent() {
  const searchParams = useSearchParams();
  const companyId = searchParams.get("companyId")?.trim() ?? "";

  const [step, setStep] = useState<Step>("select");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
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
        for (const e of list) {
          console.log(
            `Employee status resolved: ${e.inWork ? "in work" : "out of work"} (${e.id})`
          );
        }
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

  const resetToSelection = useCallback(
    (opts?: { afterAttendance?: boolean }) => {
      console.log("Resetting attendance login state");
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

  const submitPin = async () => {
    if (!companyId || !selected) return;
    if (!pin.trim()) {
      setPinError("Zadejte PIN.");
      return;
    }
    setVerifying(true);
    setPinError(null);
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
      const segFromVerify =
        data.activeSegment &&
        typeof data.activeSegment === "object" &&
        (data.activeSegment.sourceType === "job" || data.activeSegment.sourceType === "tariff")
          ? data.activeSegment
          : null;
      setActiveSegment(segFromVerify);

      console.log(`Employee status resolved: ${inW ? "in work" : "out of work"} (${selected.id})`);

      setJobsLoading(true);
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
      if (jr.ok && Array.isArray(jd.jobs)) {
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
      setStep("work");
    } catch {
      setPinError("Ověření se nezdařilo.");
    } finally {
      setVerifying(false);
      setJobsLoading(false);
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
        alert(typeof data.error === "string" ? data.error : "Uložení se nezdařilo.");
        return;
      }
      console.log("Attendance saved");
      if (action === "check-in") {
        setSessionInWork(true);
        if (data.activeSegment) {
          setActiveSegment(data.activeSegment);
        } else {
          setActiveSegment(null);
        }
      } else {
        resetToSelection({ afterAttendance: true });
      }
    } catch {
      alert("Uložení se nezdařilo.");
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
        alert(typeof data.error === "string" ? data.error : "Ukončení se nezdařilo.");
        return;
      }
      setActiveSegment(null);
      setSelectedJob(null);
      setSelectedTariff(null);
    } catch {
      alert("Ukončení se nezdařilo.");
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
        alert(typeof data.error === "string" ? data.error : "Přepnutí se nezdařilo.");
        return;
      }
      if (data.activeSegment) {
        setActiveSegment(data.activeSegment);
      }
    } catch {
      alert("Přepnutí se nezdařilo.");
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
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-8 pb-12 sm:px-6">
      <header className="mb-8 flex items-center justify-between gap-3">
        {step !== "select" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2 text-slate-300 hover:bg-white/10 hover:text-white"
            onClick={goBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Zpět
          </Button>
        ) : (
          <span className="w-20" />
        )}
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-400/90">Docházka</p>
          <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">Přihlášení zaměstnance</h1>
        </div>
        {step === "work" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2 text-slate-300 hover:bg-white/10 hover:text-white"
            onClick={() => resetToSelection()}
          >
            <LogOut className="h-4 w-4" />
            Zrušit
          </Button>
        ) : (
          <span className="w-20" />
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
        <div className="flex flex-1 flex-col gap-6">
          <p className="text-center text-base text-slate-400">Vyberte svůj profil</p>
          {loadingList ? (
            <div className="flex flex-1 items-center justify-center py-24">
              <Loader2 className="h-12 w-12 animate-spin text-emerald-500/60" />
            </div>
          ) : employees.length === 0 ? (
            <p className="text-center text-slate-500">Žádní aktivní zaměstnanci.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {employees.map((emp) => {
                const inWork = emp.inWork === true;
                return (
                  <li key={emp.id}>
                    <button
                      type="button"
                      onClick={() => selectEmployee(emp)}
                      className={cn(
                        "group relative flex w-full flex-col items-center gap-3 rounded-2xl border-4 p-6 text-center shadow-lg transition",
                        "min-h-[160px] active:scale-[0.99]",
                        inWork
                          ? "border-emerald-400/90 bg-gradient-to-br from-emerald-900/50 via-emerald-950/40 to-slate-950/90 ring-2 ring-emerald-500/40"
                          : "border-rose-500/80 bg-gradient-to-br from-rose-950/50 via-slate-900/60 to-slate-950/90 ring-2 ring-rose-500/35"
                      )}
                    >
                      <Badge
                        className={cn(
                          "absolute right-3 top-3 text-xs font-semibold shadow-md",
                          inWork
                            ? "border-emerald-300/50 bg-emerald-500 text-white hover:bg-emerald-500"
                            : "border-rose-300/50 bg-rose-600 text-white hover:bg-rose-600"
                        )}
                      >
                        {inWork ? "V práci" : "Mimo práci"}
                      </Badge>
                      <Avatar
                        className={cn(
                          "h-20 w-20 border-2 shadow-md",
                          inWork ? "border-emerald-300/60" : "border-rose-300/50"
                        )}
                      >
                        {emp.photoURL ? (
                          <AvatarImage src={emp.photoURL} alt="" className="object-cover" />
                        ) : null}
                        <AvatarFallback
                          className={cn(
                            "text-2xl font-medium text-white",
                            inWork ? "bg-emerald-800" : "bg-rose-900"
                          )}
                        >
                          {initials(emp.firstName, emp.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-lg font-semibold leading-tight text-white">
                        {emp.firstName} {emp.lastName}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
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
        <div className="flex flex-1 flex-col gap-8">
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
                      ? "Směna běží. Můžete pracovat na zakázce nebo tarifu, nebo zůstat obecně v práci až do odchodu."
                      : "Zaznamenejte příchod do práce."}
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
                className="h-12 shrink-0 rounded-xl border-amber-400/40 bg-amber-950/40 text-amber-foreground hover:bg-amber-900/50"
                disabled={switching || actionSaving}
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

          {sessionInWork &&
            (jobsLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-10 w-10 animate-spin text-emerald-500/70" />
              </div>
            ) : hasChoice ? (
              <div className="space-y-4">
                <p className="text-center text-sm font-medium text-slate-200">Na čem právě pracujete</p>
                <p className="text-center text-xs text-slate-500">
                  Klepnutím přepnete úsek — směna zůstane otevřená. Nebo ukončete aktivní zakázku / tarif
                  výše.
                </p>

                {jobs.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Zakázky</p>
                    <div className="grid max-h-[min(32vh,280px)] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                      {jobs.map((j) => {
                        const activeCard =
                          sessionInWork && segmentMatchesCard(activeSegment, "job", j.id);
                        return (
                          <button
                            key={j.id}
                            type="button"
                            disabled={switching || actionSaving}
                            onClick={() => pickJob(j)}
                            className={cn(
                              "rounded-2xl border px-4 py-4 text-left text-sm font-medium transition",
                              activeCard
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
                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={switching || actionSaving}
                            onClick={() => pickTariff(t)}
                            className={cn(
                              "rounded-2xl border px-4 py-4 text-left text-sm font-medium transition",
                              activeCard
                                ? "border-amber-400/90 bg-amber-500/20 text-white shadow-md"
                                : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                            )}
                          >
                            <span className="block">{t.name}</span>
                            {t.hourlyRateCzk != null && (
                              <span className="mt-1 block text-xs text-slate-400">
                                {t.hourlyRateCzk} Kč / hod
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(switching || actionSaving) && (
                  <p className="text-center text-xs text-slate-400">
                    {switching ? "Přepínám…" : "Ukládám…"}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-center text-sm text-slate-400">
                Žádné zakázky ani tarify k výběru — jste v práci bez zakázkového úseku. Po přiřazení v
                administraci se zobrazí zde.
              </p>
            ))}

          <div className="mt-auto">
            {!sessionInWork ? (
              <Button
                type="button"
                size="lg"
                className="h-16 w-full rounded-2xl bg-emerald-600 text-lg font-semibold shadow-lg hover:bg-emerald-500"
                disabled={actionSaving}
                onClick={() => void postAttendance("check-in")}
              >
                {actionSaving ? <Loader2 className="h-6 w-6 animate-spin" /> : "Příchod do práce"}
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                className="h-16 w-full rounded-2xl border border-rose-400/50 bg-rose-700 text-lg font-semibold text-white shadow-lg hover:bg-rose-600"
                disabled={actionSaving || !canCheckOut}
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
