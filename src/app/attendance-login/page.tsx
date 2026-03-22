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
  todayHoursWorked?: number;
  todayEarningsEstimate?: number;
};

type JobRow = { id: string; name: string };

type Step = "select" | "pin" | "work";

function initials(first: string, last: string) {
  const a = first.trim().charAt(0);
  const b = last.trim().charAt(0);
  return (a + b).toUpperCase() || "?";
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
  const [selectedJob, setSelectedJob] = useState<JobRow | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [actionSaving, setActionSaving] = useState(false);

  const [sessionInWork, setSessionInWork] = useState<boolean | null>(null);
  const [sessionHours, setSessionHours] = useState(0);
  const [sessionEarnings, setSessionEarnings] = useState(0);

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
      setSelectedJob(null);
      setSessionInWork(null);
      setSessionHours(0);
      setSessionEarnings(0);
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
        todayHoursWorked?: number;
        todayEarningsEstimate?: number;
      };
      if (!res.ok || !data.ok) {
        setPinError(typeof data.error === "string" ? data.error : "Neplatný PIN");
        return;
      }
      const inW = data.inWork === true;
      setSessionInWork(inW);
      setSessionHours(typeof data.todayHoursWorked === "number" ? data.todayHoursWorked : 0);
      setSessionEarnings(
        typeof data.todayEarningsEstimate === "number" ? data.todayEarningsEstimate : 0
      );
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
      const jd = (await jr.json().catch(() => ({}))) as { jobs?: JobRow[] };
      if (jr.ok && Array.isArray(jd.jobs)) {
        setJobs(jd.jobs);
        if (jd.jobs.length === 1) setSelectedJob(jd.jobs[0]!);
        else setSelectedJob(null);
      } else {
        setJobs([]);
        setSelectedJob(null);
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
      const res = await fetch("/api/attendance-login/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          employeeId: selected.id,
          pin,
          action,
          employeeName: `${selected.firstName} ${selected.lastName}`.trim(),
          jobId: selectedJob?.id ?? null,
          jobName: selectedJob?.name ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(typeof data.error === "string" ? data.error : "Uložení se nezdařilo.");
        return;
      }
      console.log("Attendance saved");
      resetToSelection({ afterAttendance: true });
    } catch {
      alert("Uložení se nezdařilo.");
    } finally {
      setActionSaving(false);
    }
  };

  const fullName = selected
    ? `${selected.firstName} ${selected.lastName}`.trim() || "Zaměstnanec"
    : "";

  const jobRequired = jobs.length > 0;
  const canAct = !jobRequired || !!selectedJob;

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
                      <span className="text-xs tabular-nums text-slate-300">
                        Dnes: {typeof emp.todayHoursWorked === "number" ? `${emp.todayHoursWorked} h` : "—"}
                        {typeof emp.todayEarningsEstimate === "number" && emp.todayEarningsEstimate > 0
                          ? ` · ${Math.round(emp.todayEarningsEstimate)} Kč`
                          : ""}
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
                  <p className="text-sm text-slate-200">
                    Dnes: {sessionHours > 0 ? `${sessionHours} h` : "—"}
                    {sessionEarnings > 0 ? ` · odhad ${Math.round(sessionEarnings)} Kč` : ""}
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    {sessionInWork
                      ? "Zaznamenejte odchod z práce."
                      : "Zaznamenejte příchod do práce."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {jobsLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-500/70" />
            </div>
          ) : jobs.length > 0 ? (
            <div className="space-y-3">
              <p className="text-center text-sm font-medium text-slate-300">Vyberte zakázku</p>
              <div className="grid max-h-[min(40vh,320px)] gap-2 overflow-y-auto pr-1">
                {jobs.map((j) => (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => setSelectedJob(j)}
                    className={cn(
                      "rounded-2xl border px-4 py-4 text-left text-sm font-medium transition",
                      selectedJob?.id === j.id
                        ? "border-emerald-400/90 bg-emerald-500/25 text-white shadow-md"
                        : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                    )}
                  >
                    {j.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-auto">
            {!sessionInWork ? (
              <Button
                type="button"
                size="lg"
                className="h-16 w-full rounded-2xl bg-emerald-600 text-lg font-semibold shadow-lg hover:bg-emerald-500"
                disabled={actionSaving || !canAct}
                onClick={() => void postAttendance("check-in")}
              >
                {actionSaving ? <Loader2 className="h-6 w-6 animate-spin" /> : "Příchod do práce"}
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                className="h-16 w-full rounded-2xl border border-rose-400/50 bg-rose-700 text-lg font-semibold text-white shadow-lg hover:bg-rose-600"
                disabled={actionSaving || !canAct}
                onClick={() => void postAttendance("check-out")}
              >
                {actionSaving ? <Loader2 className="h-6 w-6 animate-spin" /> : "Odchod z práce"}
              </Button>
            )}
          </div>
          {jobRequired && !selectedJob && (
            <p className="text-center text-sm text-amber-200/90">Nejdřív vyberte zakázku.</p>
          )}
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
