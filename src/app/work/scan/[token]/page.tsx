"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Employee = { id: string; firstName: string; lastName: string };
type TaskInfo = { id: string; name: string; description?: string | null; status: string };

type FlashState = {
  employeeName: string;
  taskName: string;
  previousTaskStopped: boolean;
  alreadySame: boolean;
};

type UiPhase = "login" | "flash" | "ready";

function fullName(e: Employee) {
  return `${e.firstName} ${e.lastName}`.trim() || "Zaměstnanec";
}

export default function WorkScanPage() {
  const params = useParams();
  const token = String(params.token ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobName, setJobName] = useState("");
  const [task, setTask] = useState<TaskInfo | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<UiPhase>("login");
  const [flash, setFlash] = useState<FlashState | null>(null);

  const resetForNextWorker = useCallback(() => {
    setSelectedId(null);
    setPin("");
    setError(null);
    setFlash(null);
    setPhase("login");
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    try {
      const [infoRes, empRes] = await Promise.all([
        fetch(`/api/public/work-task/${encodeURIComponent(token)}`),
        fetch(`/api/public/work-task/${encodeURIComponent(token)}/employees`),
      ]);
      if (!infoRes.ok) {
        const j = await infoRes.json().catch(() => ({}));
        throw new Error(String(j.error ?? "QR kód není platný."));
      }
      if (!empRes.ok) throw new Error("Nepodařilo načíst zaměstnance.");
      const info = await infoRes.json();
      const emps = await empRes.json();
      setJobName(String(info.jobName ?? ""));
      setTask(info.task as TaskInfo);
      setEmployees(Array.isArray(emps.employees) ? emps.employees : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba načtení.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (phase !== "flash" || !flash) return;
    const t = window.setTimeout(() => {
      setPhase("ready");
    }, 1600);
    return () => window.clearTimeout(t);
  }, [phase, flash]);

  const selected = useMemo(
    () => employees.find((e) => e.id === selectedId) ?? null,
    [employees, selectedId]
  );

  const startWork = async () => {
    if (!selectedId || !pin.trim()) return;
    if (!navigator.onLine) {
      setOffline(true);
      setError("Není připojení k serveru. Zkuste to znovu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/work-task/${encodeURIComponent(token)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selectedId, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = String(data.error ?? "Start se nezdařil.");
        setPin("");
        setSelectedId(null);
        setError(msg);
        setPhase("ready");
        return;
      }

      const employeeName = String(data.employee?.name ?? fullName(selected!));
      const taskName = String(data.activeTask?.taskName ?? task?.name ?? "Úkol");
      setPin("");
      setSelectedId(null);
      setFlash({
        employeeName,
        taskName,
        previousTaskStopped: Boolean(data.previousTaskStopped),
        alreadySame: Boolean(data.alreadyActiveOnSameTask),
      });
      setPhase("flash");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba.");
    } finally {
      setBusy(false);
    }
  };

  const showLogin = phase === "login";
  const showFlash = phase === "flash" && flash;
  const showReady = phase === "ready";

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-50 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md space-y-5">
        <header className="text-center space-y-1">
          <p className="text-xs font-semibold tracking-widest text-orange-400">RAJMONDATA VÝROBA</p>
          <h1 className="text-xl font-bold">
            {showReady ? "Připraveno pro dalšího pracovníka" : "Výrobní úkol"}
          </h1>
        </header>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
          </div>
        ) : error && !task ? (
          <p className="text-center text-red-300">{error}</p>
        ) : task ? (
          <>
            {!showReady ? (
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-4 space-y-2">
                <p className="text-sm text-slate-400">Zakázka</p>
                <p className="font-semibold text-lg leading-snug">{jobName}</p>
                <p className="text-sm text-slate-400 pt-2">Úkol</p>
                <p className="font-medium">{task.name}</p>
              </div>
            ) : null}

            {offline ? (
              <p className="text-sm text-amber-300 text-center">
                Není připojení k serveru. Zkuste to znovu.
              </p>
            ) : null}

            {showFlash && flash ? (
              <div className="rounded-xl border border-emerald-600/50 bg-emerald-950/50 p-6 text-center space-y-3">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" aria-hidden />
                <p className="text-lg font-semibold text-emerald-200">{flash.employeeName}</p>
                {flash.previousTaskStopped ? (
                  <p className="text-sm text-slate-300">Předchozí úkol ukončen</p>
                ) : null}
                <p className="text-sm text-emerald-300">
                  {flash.alreadySame ? "Úkol už běží" : "Práce spuštěna"}
                </p>
                <p className="font-medium text-lg">{flash.taskName}</p>
              </div>
            ) : null}

            {showReady ? (
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-6 text-center space-y-4">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" aria-hidden />
                <p className="font-medium text-emerald-300">Úkol spuštěn</p>
                <p className="text-sm text-slate-400">
                  Naskenujte další QR kód nebo vyberte dalšího pracovníka na tomto úkolu.
                </p>
                {error ? <p className="text-sm text-red-300">{error}</p> : null}
                <Button
                  type="button"
                  className="min-h-[52px] w-full bg-orange-600 hover:bg-orange-700 text-base font-semibold"
                  onClick={resetForNextWorker}
                >
                  Další pracovník
                </Button>
              </div>
            ) : null}

            {showLogin ? (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-300">Vyber pracovníka</p>
                  <div className="grid gap-2">
                    {employees.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        className={cn(
                          "min-h-[52px] rounded-lg border px-4 text-left font-medium transition",
                          selectedId === e.id
                            ? "border-orange-500 bg-orange-500/15"
                            : "border-slate-700 bg-slate-900"
                        )}
                        onClick={() => setSelectedId(e.id)}
                      >
                        {fullName(e)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-300">PIN</p>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    name="production-pin"
                    placeholder="••••"
                    className="min-h-[52px] text-center text-xl tracking-[0.3em]"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  className="min-h-[52px] w-full bg-orange-600 hover:bg-orange-700 text-base font-semibold"
                  disabled={busy || !selectedId || !pin.trim()}
                  onClick={() => void startWork()}
                >
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Začít práci"}
                </Button>
              </>
            ) : null}

            {error && showLogin ? (
              <p className="text-sm text-red-300 text-center">{error}</p>
            ) : null}
            {selected && showLogin ? (
              <p className="text-xs text-center text-slate-500">
                Přihlášení stejným PINem jako docházkový terminál. Po startu se obrazovka resetuje
                pro dalšího pracovníka.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
