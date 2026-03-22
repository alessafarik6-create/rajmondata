"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type EmployeeRow = {
  id: string;
  firstName: string;
  lastName: string;
  photoURL: string | null;
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
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    console.log("Attendance page loaded");
  }, []);

  useEffect(() => {
    if (!companyId) {
      setLoadingList(false);
      setLoadError("Chybí odkaz s ID firmy (companyId). Otevřete stránku z portálu.");
      return;
    }
    let cancelled = false;
    setLoadingList(true);
    setLoadError(null);
    void fetch(`/api/attendance-login/employees?companyId=${encodeURIComponent(companyId)}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          employees?: EmployeeRow[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Nepodařilo se načíst zaměstnance.");
        }
        if (!cancelled) {
          setEmployees(Array.isArray(data.employees) ? data.employees : []);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Chyba načtení.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const selectEmployee = useCallback((emp: EmployeeRow) => {
    console.log("Employee selected", emp.id);
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
      setPin("");
      setJobs([]);
      setSelectedJob(null);
      setStep("pin");
    }
  };

  const logout = () => {
    setSelected(null);
    setPin("");
    setPinError(null);
    setJobs([]);
    setSelectedJob(null);
    setActionMessage(null);
    setStep("select");
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
    console.log("PIN verifying");
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
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setPinError(typeof data.error === "string" ? data.error : "Neplatný PIN");
        return;
      }
      console.log("PIN success");
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
      setActionMessage(
        action === "check-in" ? "Příchod byl uložen." : "Odchod byl uložen."
      );
    } catch {
      alert("Uložení se nezdařilo.");
    } finally {
      setActionSaving(false);
    }
  };

  const fullName = selected
    ? `${selected.firstName} ${selected.lastName}`.trim() || "Zaměstnanec"
    : "";

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-6 pb-10">
      <header className="mb-6 flex items-center justify-between gap-3">
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
          <span />
        )}
        <h1 className="text-center text-lg font-semibold tracking-tight text-white">Docházka</h1>
        {step === "work" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2 text-slate-300 hover:bg-white/10 hover:text-white"
            onClick={logout}
          >
            <LogOut className="h-4 w-4" />
            Odhlásit
          </Button>
        ) : (
          <span className="w-[88px]" />
        )}
      </header>

      {!companyId && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
          {loadError}
        </p>
      )}

      {companyId && loadError && (
        <p className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-100">{loadError}</p>
      )}

      {companyId && !loadError && step === "select" && (
        <div className="flex flex-1 flex-col gap-4">
          <p className="text-center text-sm text-slate-400">Vyberte svůj profil</p>
          {loadingList ? (
            <div className="flex flex-1 items-center justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-slate-500" />
            </div>
          ) : employees.length === 0 ? (
            <p className="text-center text-slate-400">Žádní aktivní zaměstnanci.</p>
          ) : (
            <ul className="grid gap-3">
              {employees.map((emp) => (
                <li key={emp.id}>
                  <button
                    type="button"
                    onClick={() => selectEmployee(emp)}
                    className={cn(
                      "flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-left",
                      "min-h-[56px] transition hover:bg-white/10 active:scale-[0.99]"
                    )}
                  >
                    <Avatar className="h-14 w-14 border border-white/10">
                      {emp.photoURL ? (
                        <AvatarImage src={emp.photoURL} alt="" className="object-cover" />
                      ) : null}
                      <AvatarFallback className="bg-slate-700 text-lg text-white">
                        {initials(emp.firstName, emp.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-lg font-medium text-white">
                      {emp.firstName} {emp.lastName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {companyId && step === "pin" && selected && (
        <div className="flex flex-1 flex-col gap-6">
          <div className="flex flex-col items-center gap-2">
            <Avatar className="h-20 w-20 border-2 border-white/20">
              {selected.photoURL ? (
                <AvatarImage src={selected.photoURL} alt="" className="object-cover" />
              ) : null}
              <AvatarFallback className="bg-slate-700 text-xl">
                {initials(selected.firstName, selected.lastName)}
              </AvatarFallback>
            </Avatar>
            <p className="text-lg font-medium text-white">{fullName}</p>
            <p className="text-slate-400">Zadejte PIN</p>
          </div>

          <div
            className="rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-center font-mono text-3xl tracking-[0.4em] text-white"
            aria-live="polite"
          >
            {pin.replace(/./g, "•")}
          </div>

          {pinError && <p className="text-center text-sm text-red-400">{pinError}</p>}

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
              k === "" ? (
                <span key={`e-${i}`} />
              ) : (
                <Button
                  key={k}
                  type="button"
                  variant="secondary"
                  className="h-14 text-xl font-semibold sm:h-16"
                  onClick={() => (k === "⌫" ? backspace() : appendDigit(k))}
                >
                  {k}
                </Button>
              )
            )}
          </div>

          <Button
            type="button"
            className="h-14 text-lg"
            disabled={verifying || !pin}
            onClick={() => void submitPin()}
          >
            {verifying ? <Loader2 className="h-6 w-6 animate-spin" /> : "Potvrdit"}
          </Button>
        </div>
      )}

      {companyId && step === "work" && selected && (
        <div className="flex flex-1 flex-col gap-6">
          <div className="text-center">
            <p className="text-sm text-slate-400">Přihlášen(a)</p>
            <p className="text-2xl font-semibold text-white">{fullName}</p>
          </div>

          {jobsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            </div>
          ) : jobs.length > 0 ? (
            <div className="space-y-3">
              <p className="text-center text-sm font-medium text-slate-300">Vyberte zakázku</p>
              <div className="grid max-h-[40vh] gap-2 overflow-y-auto pr-1">
                {jobs.map((j) => (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => setSelectedJob(j)}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left text-sm transition",
                      selectedJob?.id === j.id
                        ? "border-emerald-500/80 bg-emerald-500/20 text-white"
                        : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                    )}
                  >
                    {j.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-auto grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              className="h-14 text-lg bg-emerald-600 hover:bg-emerald-500"
              disabled={actionSaving || (jobs.length > 0 && !selectedJob)}
              onClick={() => void postAttendance("check-in")}
            >
              {actionSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Příchod do práce"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-14 text-lg border-white/20 bg-white/10 text-white hover:bg-white/20"
              disabled={actionSaving}
              onClick={() => void postAttendance("check-out")}
            >
              {actionSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Odchod z práce"}
            </Button>
          </div>
          {jobs.length > 0 && !selectedJob && (
            <p className="text-center text-xs text-amber-200/90">Pro příchod vyberte zakázku.</p>
          )}
          {actionMessage && (
            <p className="text-center text-sm text-emerald-300">{actionMessage}</p>
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
          <Loader2 className="h-10 w-10 animate-spin text-slate-500" />
        </div>
      }
    >
      <AttendanceLoginContent />
    </Suspense>
  );
}
