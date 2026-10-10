"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  attendanceMessageForCode,
  WORK_SCAN_I18N,
  type WorkScanLang,
} from "@/lib/production-qr/production-work-scan-i18n";

type Employee = { id: string; firstName: string; lastName: string };
type TaskInfo = {
  id: string;
  name: string;
  nameUk?: string | null;
  description?: string | null;
  descriptionUk?: string | null;
  status: string;
};

type FlashState = {
  employeeName: string;
  taskName: string;
  previousTaskStopped: boolean;
  alreadySame: boolean;
};

type UiPhase = "login" | "flash" | "ready";

type AttendanceBlock = {
  code?: string;
  message?: string;
};

function fullName(e: Employee) {
  return `${e.firstName} ${e.lastName}`.trim() || "Zaměstnanec";
}

export default function WorkScanPage() {
  const params = useParams();
  const token = String(params.token ?? "").trim();

  const [lang, setLang] = useState<WorkScanLang>("cs");
  const L = WORK_SCAN_I18N[lang];

  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attendanceBlock, setAttendanceBlock] = useState<AttendanceBlock | null>(null);
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
    setAttendanceBlock(null);
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
    const t = window.setTimeout(() => setPhase("ready"), 1600);
    return () => window.clearTimeout(t);
  }, [phase, flash]);

  const selected = useMemo(
    () => employees.find((e) => e.id === selectedId) ?? null,
    [employees, selectedId]
  );

  const taskTitle = useMemo(() => {
    if (!task) return "";
    if (lang === "ua" && task.nameUk?.trim()) return task.nameUk.trim();
    return task.name;
  }, [task, lang]);

  const startWork = async () => {
    if (!selectedId || !pin.trim()) return;
    if (!navigator.onLine) {
      setOffline(true);
      setError(L.offline);
      return;
    }
    setBusy(true);
    setError(null);
    setAttendanceBlock(null);
    try {
      const res = await fetch(`/api/public/work-task/${encodeURIComponent(token)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selectedId, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.attendanceBlocked || data.code) {
          setAttendanceBlock({
            code: String(data.code ?? ""),
            message: attendanceMessageForCode(lang, String(data.code ?? "")),
          });
        } else {
          setError(String(data.error ?? "Start se nezdařil."));
        }
        setPin("");
        setPhase("login");
        return;
      }

      const employeeName = String(data.employee?.name ?? fullName(selected!));
      const taskName = String(data.activeTask?.taskName ?? task?.name ?? "Úkol");
      setPin("");
      setSelectedId(null);
      setAttendanceBlock(null);
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
    <div className="min-h-[100dvh] bg-slate-950 text-slate-50 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] overflow-x-hidden">
      <div className="mx-auto w-full max-w-md space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold tracking-widest text-orange-400">{L.brand}</p>
          <div className="flex rounded-md border border-slate-700 overflow-hidden text-xs">
            <button
              type="button"
              className={cn("px-2.5 py-1", lang === "cs" && "bg-orange-600 text-white")}
              onClick={() => setLang("cs")}
            >
              {L.langCs}
            </button>
            <button
              type="button"
              className={cn("px-2.5 py-1", lang === "ua" && "bg-orange-600 text-white")}
              onClick={() => setLang("ua")}
            >
              {L.langUa}
            </button>
          </div>
        </div>

        <header className="text-center">
          <h1 className="text-lg font-bold leading-tight">
            {showReady ? L.readyHeader : L.taskHeader}
          </h1>
        </header>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
          </div>
        ) : error && !task ? (
          <p className="text-center text-red-300">{error}</p>
        ) : task && showLogin ? (
          <>
            <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm">
              <p className="text-slate-400 text-xs">{L.job}</p>
              <p className="font-semibold leading-snug">{jobName}</p>
              <p className="text-slate-400 text-xs mt-1.5">{L.task}</p>
              <p className="font-medium">{taskTitle}</p>
            </div>

            {attendanceBlock ? (
              <div
                className="rounded-lg border-2 border-red-500 bg-red-950/90 p-3 text-red-50"
                role="alert"
              >
                <div className="flex gap-2 items-start">
                  <AlertTriangle className="h-8 w-8 shrink-0 text-red-400" aria-hidden />
                  <div>
                    <p className="text-base font-bold uppercase tracking-wide">
                      {WORK_SCAN_I18N[lang].attendanceTitle}
                    </p>
                    <p className="mt-2 text-sm whitespace-pre-line leading-relaxed">
                      {attendanceBlock.message}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {offline ? <p className="text-sm text-amber-300 text-center">{L.offline}</p> : null}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-200" htmlFor="prod-pin">
                {L.pin}
              </label>
              <Input
                id="prod-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                name="production-pin"
                placeholder={L.pinPlaceholder}
                className="min-h-[56px] text-center text-2xl tracking-[0.35em] bg-slate-900 border-slate-600"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-300">{L.selectEmployee}</p>
              <div className="grid gap-1.5 max-h-[28vh] overflow-y-auto">
                {employees.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={cn(
                      "min-h-[44px] rounded-lg border px-3 text-left text-sm font-medium transition",
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

            <Button
              type="button"
              className="min-h-[52px] w-full bg-orange-600 hover:bg-orange-700 text-base font-semibold"
              disabled={busy || !selectedId || !pin.trim()}
              onClick={() => void startWork()}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : L.start}
            </Button>

            {error && !attendanceBlock ? (
              <p className="text-sm text-red-300 text-center">{error}</p>
            ) : null}
            <p className="text-[11px] text-center text-slate-500 leading-snug">{L.scanHint}</p>
          </>
        ) : null}

        {task && showFlash && flash ? (
          <div className="rounded-xl border border-emerald-600/50 bg-emerald-950/50 p-5 text-center space-y-2">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" aria-hidden />
            <p className="text-lg font-semibold text-emerald-200">{flash.employeeName}</p>
            {flash.previousTaskStopped ? (
              <p className="text-sm text-slate-300">{L.prevStopped}</p>
            ) : null}
            <p className="text-sm text-emerald-300">
              {flash.alreadySame ? L.successAlready : L.successStarted}
            </p>
            <p className="font-medium">{flash.taskName}</p>
          </div>
        ) : null}

        {task && showReady ? (
          <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" aria-hidden />
            <p className="font-medium text-emerald-300">{L.successStarted}</p>
            <Button
              type="button"
              className="min-h-[52px] w-full bg-orange-600 hover:bg-orange-700 text-base font-semibold"
              onClick={resetForNextWorker}
            >
              {L.nextWorker}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
