"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  Coffee,
  User,
  Timer,
  Loader2,
  Delete,
  X,
  AlertCircle,
  Calendar as CalendarIcon,
  Smartphone,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import {
  MAX_TERMINAL_PIN_LENGTH,
  normalizeTerminalPin,
  validateTerminalPinFormat,
} from "@/lib/terminal-pin-validation";
import { parseAssignedTerminalJobIds } from "@/lib/assigned-jobs";

type AttendanceType = "check_in" | "break_start" | "break_end" | "check_out";

export type PublicTerminalEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  attendanceQrId?: string | null;
  assignedTerminalJobIds?: string[];
};

type Props = {
  companyId: string;
  companyName: string | null;
};

/**
 * Veřejný docházkový terminál bez Firebase Auth — pouze interní stav + serverová API.
 * Žádný useUser / useAuth / Firestore klient.
 */
export function PublicTerminalApp({ companyId, companyName }: Props) {
  const { toast } = useToast();

  const [terminalReady, setTerminalReady] = useState(false);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<PublicTerminalEmployee[]>([]);

  const [pin, setPin] = useState("");
  const [pinVerifyLoading, setPinVerifyLoading] = useState(false);
  const [terminalSessionToken, setTerminalSessionToken] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<PublicTerminalEmployee | null>(null);
  const [terminalSessionEmployeeId, setTerminalSessionEmployeeId] = useState<string | null>(
    null
  );

  const [lastAction, setLastAction] = useState<AttendanceType | null>(null);
  const [todaySummary, setTodaySummary] = useState({
    checkIn: "--:--",
    checkOut: "--:--",
    worked: "0h 0m",
  });

  const [terminalJobOptions, setTerminalJobOptions] = useState<{ id: string; name: string }[]>(
    []
  );
  const [terminalJobsLoading, setTerminalJobsLoading] = useState(false);
  const [jobPickOpen, setJobPickOpen] = useState(false);

  const [currentTime, setCurrentTime] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState<string | null>(null);

  const displayCompanyName = (companyName && companyName.trim()) || PLATFORM_NAME;

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("[PublicTerminalApp] Terminal auth creation disabled");
      console.log("[PublicTerminalApp] Terminal uses PIN session only");
      console.log("[PublicTerminalApp] No Firebase auth user is created on /terminal");
    }
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("cs-CZ", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
      setCurrentDate(
        now.toLocaleDateString("cs-CZ", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEmployeesLoading(true);
    setEmployeesError(null);
    void fetch("/api/terminal/employees")
      .then(async (res) => {
        const data = (await res.json()) as { error?: string; employees?: PublicTerminalEmployee[] };
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Nelze načíst zaměstnance.");
        }
        if (!cancelled) {
          setEmployees(Array.isArray(data.employees) ? data.employees : []);
          setTerminalReady(true);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setEmployeesError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setEmployeesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const refreshTodayFromServer = useCallback(
    async (jwt: string) => {
      const res = await fetch("/api/terminal/attendance/today", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const data = (await res.json()) as {
        events?: { type?: string; millis?: number }[];
      };
      if (!res.ok || !Array.isArray(data.events) || data.events.length === 0) return;
      const evs = [...data.events].sort((a, b) => (b.millis ?? 0) - (a.millis ?? 0));
      const latest = evs[0];
      if (latest?.type) {
        setLastAction(latest.type as AttendanceType);
      }
      const checkInDoc = evs.find((e) => e.type === "check_in");
      const checkOutDoc = evs.find((e) => e.type === "check_out");
      const fmt = (ms: number | undefined) =>
        ms
          ? new Date(ms).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })
          : "--:--";
      setTodaySummary({
        checkIn: fmt(checkInDoc?.millis),
        checkOut: fmt(checkOutDoc?.millis),
        worked: "—",
      });
    },
    []
  );

  useEffect(() => {
    if (!terminalSessionToken) return;
    void refreshTodayFromServer(terminalSessionToken);
  }, [terminalSessionToken, selectedEmployee?.id, refreshTodayFromServer]);

  const loadJobsForEmployee = useCallback(
    async (jwt: string, emp: PublicTerminalEmployee) => {
      const ids = parseAssignedTerminalJobIds(emp);
      if (ids.length === 0) {
        setTerminalJobOptions([]);
        return;
      }
      setTerminalJobsLoading(true);
      try {
        const res = await fetch(
          `/api/terminal/jobs?ids=${encodeURIComponent(ids.join(","))}`,
          { headers: { Authorization: `Bearer ${jwt}` } }
        );
        const data = (await res.json()) as { error?: string; jobs?: { id: string; name: string }[] };
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Zakázky nelze načíst.");
        }
        setTerminalJobOptions(data.jobs ?? []);
      } catch {
        setTerminalJobOptions([]);
      } finally {
        setTerminalJobsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!terminalSessionToken || !selectedEmployee) {
      setTerminalJobOptions([]);
      return;
    }
    void loadJobsForEmployee(terminalSessionToken, selectedEmployee);
  }, [terminalSessionToken, selectedEmployee, loadJobsForEmployee]);

  const verifyPin = useCallback(async () => {
    const err = validateTerminalPinFormat(pin);
    if (err) {
      toast({ variant: "destructive", title: err, duration: 2500 });
      return;
    }
    const pinNorm = normalizeTerminalPin(pin);
    if (process.env.NODE_ENV === "development") {
      console.log("Looking up employee by terminal PIN");
    }
    setPinVerifyLoading(true);
    try {
      const res = await fetch("/api/terminal/verify-attendance-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinNorm, companyId }),
      });
      const data = (await res.json()) as {
        error?: string;
        employeeId?: string;
        firstName?: string;
        lastName?: string;
        terminalSessionToken?: string;
      };
      if (!res.ok) {
        setPin("");
        toast({
          variant: "destructive",
          title: "Neplatný PIN",
          description:
            typeof data.error === "string" ? data.error : "Zkuste to znovu.",
          duration: 2500,
        });
        return;
      }
      const token = data.terminalSessionToken;
      if (typeof token === "string" && token.length > 0) {
        setTerminalSessionToken(token);
      }
      const eid = String(data.employeeId ?? "");
      const fromList = employees.find((e) => e.id === eid);
      const emp: PublicTerminalEmployee =
        fromList ??
        ({
          id: eid,
          firstName: String(data.firstName ?? ""),
          lastName: String(data.lastName ?? ""),
        } as PublicTerminalEmployee);
      setSelectedEmployee(emp);
      setTerminalSessionEmployeeId(eid);
      setPin("");
      toast({ title: `Vítejte, ${emp.firstName}!`, duration: 2000 });
      if (typeof token === "string" && token.length > 0) {
        void refreshTodayFromServer(token);
      }
    } catch (e) {
      console.error("[PublicTerminalApp] verifyPin", e);
      setPin("");
      toast({ variant: "destructive", title: "Chyba ověření PINu" });
    } finally {
      setPinVerifyLoading(false);
    }
  }, [pin, employees, toast, refreshTodayFromServer, companyId]);

  const clearTerminalSession = useCallback(() => {
    setPin("");
    setTerminalSessionToken(null);
    setSelectedEmployee(null);
    setTerminalSessionEmployeeId(null);
    setLastAction(null);
    setTerminalJobOptions([]);
    setJobPickOpen(false);
  }, []);

  const handleAction = useCallback(
    async (type: AttendanceType, jobId?: string | null, jobName?: string | null) => {
      if (!terminalSessionToken || !selectedEmployee) {
        toast({
          variant: "destructive",
          title: "Relace vypršela",
          description: "Zadejte PIN znovu.",
        });
        return;
      }
      try {
        const res = await fetch("/api/terminal/attendance", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${terminalSessionToken}`,
          },
          body: JSON.stringify({
            type,
            jobId: type === "check_in" ? jobId : undefined,
            jobName: type === "check_in" ? jobName : undefined,
            employeeName: `${selectedEmployee.firstName} ${selectedEmployee.lastName}`.trim(),
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast({
            variant: "destructive",
            title: "Zápis se nezdařil",
            description: typeof data.error === "string" ? data.error : "Zkuste to znovu.",
          });
          return;
        }
        setLastAction(type);
        const messages: Record<AttendanceType, string> = {
          check_in: "Příchod zaznamenán",
          break_start: "Pauza zahájena",
          break_end: "Pauza ukončena",
          check_out: "Odchod zaznamenán",
        };
        toast({ title: messages[type], duration: 2000 });
        void refreshTodayFromServer(terminalSessionToken);
        setTimeout(clearTerminalSession, 1500);
      } catch (e) {
        console.error("[PublicTerminalApp] handleAction", e);
        toast({ variant: "destructive", title: "Akci se nepodařilo provést." });
      }
    },
    [terminalSessionToken, selectedEmployee, toast, refreshTodayFromServer, clearTerminalSession]
  );

  const initiateCheckIn = useCallback(() => {
    const ids = parseAssignedTerminalJobIds(selectedEmployee);
    if (ids.length > 0) {
      setJobPickOpen(true);
    } else {
      void handleAction("check_in", null, null);
    }
  }, [selectedEmployee, handleAction]);

  const shellClass =
    "fixed inset-0 z-40 min-h-dvh w-full overflow-y-auto bg-background flex flex-col touch-manipulation";

  const pinPad = useMemo(
    () => (
      <div className="w-full max-w-[280px] space-y-6 mx-auto">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-bold mb-1">Zadejte svůj PIN</h2>
          <p className="text-xs text-muted-foreground px-1">4–12 číslic, pak Potvrdit</p>
          <div className="flex flex-wrap justify-center gap-1 max-w-[260px] mx-auto py-1">
            {Array.from({ length: MAX_TERMINAL_PIN_LENGTH }, (_, i) => (
              <div
                key={i}
                className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full border ${
                  pin.length > i ? "bg-primary border-primary" : "border-muted-foreground/40"
                }`}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "DEL"].map((val) => (
            <Button
              key={val}
              variant={val === "C" || val === "DEL" ? "outline" : "default"}
              disabled={pinVerifyLoading}
              className={`h-20 min-h-[5rem] text-2xl font-bold rounded-xl ${
                val === "DEL" ? "text-rose-500 border-rose-500/20" : ""
              }`}
              onClick={() => {
                if (val === "C") clearTerminalSession();
                else if (val === "DEL") setPin((p) => p.slice(0, -1));
                else if (pin.length < MAX_TERMINAL_PIN_LENGTH) setPin((p) => p + val);
              }}
            >
              {val === "DEL" ? <Delete className="w-6 h-6" /> : val}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          className="w-full min-h-[52px] text-lg font-semibold touch-manipulation"
          disabled={pinVerifyLoading || pin.length === 0}
          onClick={() => void verifyPin()}
        >
          {pinVerifyLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : "Potvrdit PIN"}
        </Button>
      </div>
    ),
    [pin, pinVerifyLoading, verifyPin, clearTerminalSession]
  );

  if (employeesError) {
    return (
      <div className={`${shellClass} items-center justify-center p-6`}>
        <Alert variant="destructive" className="max-w-md w-full">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Terminál nelze načíst</AlertTitle>
          <AlertDescription>{employeesError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!terminalReady || employeesLoading) {
    return (
      <div className={`${shellClass} items-center justify-center gap-4`}>
        <Loader2 className="w-14 h-14 animate-spin text-primary" />
        <p className="text-muted-foreground">Načítání terminálu…</p>
      </div>
    );
  }

  return (
    <div className={`${shellClass} flex flex-col p-4 md:p-8 max-w-3xl mx-auto w-full min-w-0`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 shrink-0 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
            <Smartphone className="text-white w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight truncate">{displayCompanyName}</h1>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-tighter truncate">
              Docházkový terminál
            </p>
          </div>
        </div>
      </div>

      <Card className="bg-surface border-primary/20 shadow-2xl mb-6 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
        <CardContent className="pt-6 pb-4 text-center">
          <p className="text-5xl font-mono font-bold text-primary tracking-tighter mb-1">
            {currentTime || "00:00:00"}
          </p>
          <p className="text-sm text-muted-foreground font-medium flex items-center justify-center gap-2">
            <CalendarIcon className="w-3 h-3" /> {currentDate}
          </p>
        </CardContent>
      </Card>

      {!selectedEmployee && pinPad}

      {selectedEmployee && (
        <>
          <div className="flex items-center gap-4 mb-6 p-4 rounded-2xl bg-surface/50 border border-border">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <User className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">
                {selectedEmployee.firstName} {selectedEmployee.lastName}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                ID: {terminalSessionEmployeeId}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={clearTerminalSession} className="shrink-0">
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 mb-6">
            <Button
              disabled={lastAction === "check_in" || lastAction === "break_end"}
              onClick={() => initiateCheckIn()}
              className="min-h-[5.5rem] text-2xl font-bold rounded-2xl shadow-lg bg-emerald-600 hover:bg-emerald-700 transition-all gap-4"
            >
              <Play className="w-6 h-6 fill-white" /> Přihlásit příchod
            </Button>
            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                disabled={lastAction !== "check_in" && lastAction !== "break_end"}
                onClick={() => void handleAction("break_start")}
                className="min-h-[5rem] text-xl font-bold rounded-2xl border-amber-500/50 text-amber-500 gap-2"
              >
                <Coffee className="w-5 h-5" /> Pauza
              </Button>
              <Button
                variant="outline"
                disabled={lastAction !== "break_start"}
                onClick={() => void handleAction("break_end")}
                className="min-h-[5rem] text-xl font-bold rounded-2xl border-blue-500/50 text-blue-500 gap-2"
              >
                <Timer className="w-5 h-5" /> Konec pauzy
              </Button>
            </div>
            <Button
              variant="destructive"
              disabled={
                lastAction === "check_out" || !lastAction || lastAction === "break_start"
              }
              onClick={() => void handleAction("check_out")}
              className="min-h-[5.5rem] text-2xl font-bold rounded-2xl shadow-lg gap-4"
            >
              <Square className="w-6 h-6 fill-white" /> Odhlásit odchod
            </Button>
          </div>

          <Card className="bg-surface/30 border-border mt-auto">
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Timer className="w-4 h-4 text-primary" /> Dnešní přehled
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 pb-6">
              <div className="text-center p-2 rounded-xl bg-background/50 border border-border">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">Příchod</p>
                <p className="text-sm font-bold text-emerald-500">{todaySummary.checkIn}</p>
              </div>
              <div className="text-center p-2 rounded-xl bg-background/50 border border-border">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">Odchod</p>
                <p className="text-sm font-bold text-rose-500">{todaySummary.checkOut}</p>
              </div>
              <div className="text-center p-2 rounded-xl bg-background/50 border border-border">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">Stav</p>
                <p className="text-sm font-bold text-primary">{lastAction ?? "—"}</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={jobPickOpen} onOpenChange={setJobPickOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border border-border bg-background text-foreground sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl text-foreground">Zakázka pro příchod</DialogTitle>
            <DialogDescription className="text-base text-muted-foreground">
              Vyberte zakázku přiřazenou pro docházkový terminál.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {terminalJobsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : (
              terminalJobOptions.map((j) => (
                <Button
                  key={j.id}
                  type="button"
                  variant="outline"
                  className="min-h-[4.5rem] flex-col justify-center gap-1 border-border py-4 text-lg"
                  onClick={() => {
                    void handleAction("check_in", j.id, j.name);
                    setJobPickOpen(false);
                  }}
                >
                  <span className="font-semibold">{j.name}</span>
                  <span className="text-xs font-normal opacity-70">{j.id}</span>
                </Button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
