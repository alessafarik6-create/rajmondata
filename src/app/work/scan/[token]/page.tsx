"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Employee = { id: string; firstName: string; lastName: string };
type TaskInfo = { id: string; name: string; description?: string | null; status: string };

type ActiveState = {
  taskId: string;
  taskName: string;
  jobName: string;
  startedAt: string;
  entryId: string;
};

function fullName(e: Employee) {
  return `${e.firstName} ${e.lastName}`.trim() || "Zaměstnanec";
}

function formatClock(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatRunning(startedAt: string) {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
  const [active, setActive] = useState<ActiveState | null>(null);
  const [alreadySame, setAlreadySame] = useState(false);
  const [tick, setTick] = useState(0);

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
    if (!active) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [active]);

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
      if (!res.ok) throw new Error(String(data.error ?? "Start se nezdařil."));
      setPin("");
      setAlreadySame(Boolean(data.alreadyActiveOnSameTask));
      setActive({
        taskId: data.activeTask.taskId,
        taskName: data.activeTask.taskName,
        jobName: data.activeTask.jobName,
        startedAt: data.activeTask.startedAt,
        entryId: data.activeTask.entryId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba.");
    } finally {
      setBusy(false);
    }
  };

  const stopWork = async () => {
    if (!selectedId || !pin.trim()) {
      setError("Pro ukončení zadejte PIN.");
      return;
    }
    if (!navigator.onLine) {
      setError("Není připojení k serveru. Zkuste to znovu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/work-task/${encodeURIComponent(token)}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selectedId, pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error ?? "Ukončení se nezdařilo."));
      setActive(null);
      setAlreadySame(false);
      setPin("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-50 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md space-y-5">
        <header className="text-center space-y-1">
          <p className="text-xs font-semibold tracking-widest text-orange-400">RAJMONDATA</p>
          <h1 className="text-xl font-bold">Výrobní úkol</h1>
        </header>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
          </div>
        ) : error && !task ? (
          <p className="text-center text-red-300">{error}</p>
        ) : task ? (
          <>
            <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-4 space-y-2">
              <p className="text-sm text-slate-400">Zakázka</p>
              <p className="font-semibold text-lg leading-snug">{jobName}</p>
              <p className="text-sm text-slate-400 pt-2">Úkol</p>
              <p className="font-medium">{task.name}</p>
            </div>

            {offline ? (
              <p className="text-sm text-amber-300 text-center">
                Není připojení k serveru. Zkuste to znovu.
              </p>
            ) : null}

            {active ? (
              <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/40 p-4 space-y-3">
                <p className="text-sm font-semibold text-emerald-300">
                  {alreadySame ? "Tento úkol už máte spuštěný" : "Práce zahájena"}
                </p>
                <p className="font-medium">{active.taskName}</p>
                <p className="text-sm text-slate-300">{active.jobName}</p>
                <p className="text-sm text-slate-400">
                  Čas od: {formatClock(active.startedAt)}
                </p>
                <p className="text-2xl font-mono tabular-nums" aria-live="polite">
                  {formatRunning(active.startedAt)}
                  <span className="sr-only">{tick}</span>
                </p>
                <div className="flex flex-col gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-[48px] w-full"
                    onClick={() => setActive(active)}
                  >
                    Pokračovat
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-[48px] w-full"
                    disabled={busy}
                    onClick={() => void stopWork()}
                  >
                    Ukončit práci
                  </Button>
                </div>
                <Input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="PIN pro ukončení"
                  className="min-h-[48px] text-center text-lg tracking-widest"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </div>
            ) : (
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
            )}

            {error ? <p className="text-sm text-red-300 text-center">{error}</p> : null}
            {selected && !active ? (
              <p className="text-xs text-center text-slate-500">
                Přihlášení stejným PINem jako docházkový terminál.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
