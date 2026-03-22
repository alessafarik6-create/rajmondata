"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  Coffee,
  User,
  Timer,
  ChevronRight,
  LogOut,
  Calendar as CalendarIcon,
  Loader2,
  Smartphone,
  Delete,
  X,
  Camera,
  AlertCircle,
  Inbox,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCollection,
  useAuth,
  useCompany,
} from "@/firebase";
import {
  doc,
  collection,
  serverTimestamp,
  query,
  orderBy,
  where,
  documentId,
  getDocs,
} from "firebase/firestore";
import { addDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { errorEmitter } from "@/firebase/error-emitter";
import { FirestorePermissionError } from "@/firebase/errors";
import { useToast } from "@/hooks/use-toast";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import { logFirestoreFailure } from "@/lib/firestore-log";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  signInWithEmailAndPassword,
  type AuthError,
} from "firebase/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  parseAssignedTerminalJobIds,
  chunkArray,
} from "@/lib/assigned-jobs";

export type AttendanceTerminalProps = {
  /** Veřejný tablet — bez portálové navigace, výchozí režim PIN. */
  standalone?: boolean;
  /** Např. z ?company= nebo /companies/[companyId]/terminal — musí odpovídat účtu. */
  companyIdOverride?: string | null;
  /**
   * Legacy: relace z `/api/terminal/session` (custom token kiosk).
   */
  kioskTokenSession?: boolean;
  /**
   * Odkaz `/terminal/[token]` — ověření firmy tokenem, přihlášení e-mailem/heslem, bez PIN/QR.
   */
  employeeTokenEntry?: boolean;
};

type AttendanceType = "check_in" | "break_start" | "break_end" | "check_out";
type TerminalMode = "personal" | "pin" | "qr";

export function AttendanceTerminal({
  standalone = false,
  companyIdOverride = null,
  kioskTokenSession = false,
  employeeTokenEntry = false,
}: AttendanceTerminalProps) {
  const { user } = useUser();
  const auth = useAuth();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();
  const { companyName } = useCompany();

  const [terminalMode, setTerminalMode] = useState<TerminalMode>(() =>
    standalone ? "pin" : "personal"
  );
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [pin, setPin] = useState("");
  const [activeEmployee, setActiveEmployee] = useState<any | null>(null);
  const [currentTime, setCurrentTime] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<AttendanceType | null>(null);
  const [todaySummary, setTodaySummary] = useState({
    checkIn: "--:--",
    checkOut: "--:--",
    worked: "0h 0m",
  });
  const [isScanning, setIsScanning] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const scannerRef = useRef<any>(null);

  useEffect(() => {
    if (employeeTokenEntry) {
      setTerminalMode("personal");
      return;
    }
    if (kioskTokenSession) {
      setTerminalMode("pin");
    }
  }, [kioskTokenSession, employeeTokenEntry]);

  useEffect(() => {
    setIsClient(true);
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

  const userRef = useMemoFirebase(
    () =>
      user && firestore ? doc(firestore, "users", user.uid) : null,
    [firestore, user]
  );
  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
  } = useDoc(userRef);
  const override = companyIdOverride?.trim();
  const fromProfile = profile?.companyId as string | undefined;
  const isKioskSession = Boolean(kioskTokenSession && override && !employeeTokenEntry);
  const companyAccessDenied =
    !isKioskSession &&
    Boolean(
      user &&
        profile &&
        override &&
        fromProfile &&
        override !== fromProfile
    ) &&
    !(
      Array.isArray((profile as { globalRoles?: string[] }).globalRoles) &&
      (profile as { globalRoles?: string[] }).globalRoles!.includes("super_admin")
    );

  const effectiveCompanyId = companyAccessDenied
    ? undefined
    : override || fromProfile;

  /** Stejný model jako /portal/employee/attendance — employeeId v DB může být auth UID nebo employees/{id}. */
  const profileEmployeeId = profile?.employeeId as string | undefined;

  const employeeSelfRef = useMemoFirebase(
    () =>
      firestore && effectiveCompanyId && profileEmployeeId
        ? doc(
            firestore,
            "companies",
            effectiveCompanyId,
            "employees",
            profileEmployeeId
          )
        : null,
    [firestore, effectiveCompanyId, profileEmployeeId]
  );
  const {
    data: employeeDocSelf,
    error: employeeSelfError,
  } = useDoc(employeeSelfRef);

  const [terminalJobOptions, setTerminalJobOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [terminalJobsLoading, setTerminalJobsLoading] = useState(false);
  const [jobPickOpen, setJobPickOpen] = useState(false);

  const companyDocRef = useMemoFirebase(
    () =>
      firestore && effectiveCompanyId
        ? doc(firestore, "companies", effectiveCompanyId)
        : null,
    [firestore, effectiveCompanyId]
  );
  const { data: companyDoc, error: companyDocError } = useDoc(companyDocRef);
  const displayCompanyName =
    (companyDoc as { companyName?: string; name?: string } | null)?.companyName ||
    (companyDoc as { name?: string } | null)?.name ||
    companyName ||
    PLATFORM_NAME;

  const personalAttendanceQuery = useMemoFirebase(() => {
    if (!firestore || !effectiveCompanyId || !user || terminalMode !== "personal")
      return null;
    try {
      const today = new Date().toISOString().split("T")[0];
      const ids = [...new Set([profileEmployeeId, user.uid].filter(Boolean))] as string[];
      if (ids.length === 0) return null;
      const base = collection(firestore, "companies", effectiveCompanyId, "attendance");
      if (ids.length === 1) {
        return query(
          base,
          where("employeeId", "==", ids[0]),
          where("date", "==", today),
          orderBy("timestamp", "desc")
        );
      }
      return query(
        base,
        where("employeeId", "in", ids),
        where("date", "==", today),
        orderBy("timestamp", "desc")
      );
    } catch (e) {
      logFirestoreFailure(
        effectiveCompanyId
          ? `companies/${effectiveCompanyId}/attendance`
          : "(unknown)",
        "listen-query",
        e
      );
      return null;
    }
  }, [firestore, effectiveCompanyId, user, terminalMode, profileEmployeeId]);

  const {
    data: todayAttendanceRaw,
    isLoading: attendanceLoading,
    error: attendanceError,
  } = useCollection(personalAttendanceQuery);

  const todayAttendance = useMemo(
    () => (Array.isArray(todayAttendanceRaw) ? todayAttendanceRaw : []),
    [todayAttendanceRaw]
  );

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !effectiveCompanyId || terminalMode === "personal") return null;
    try {
      return collection(firestore, "companies", effectiveCompanyId, "employees");
    } catch (e) {
      logFirestoreFailure(
        effectiveCompanyId
          ? `companies/${effectiveCompanyId}/employees`
          : "(unknown)",
        "listen-query",
        e
      );
      return null;
    }
  }, [firestore, effectiveCompanyId, terminalMode]);

  const {
    data: employeesRaw,
    isLoading: employeesLoading,
    error: employeesError,
  } = useCollection(employeesQuery);

  const employees = useMemo(
    () => (Array.isArray(employeesRaw) ? employeesRaw : []),
    [employeesRaw]
  );

  useEffect(() => {
    if (!firestore || !effectiveCompanyId) {
      setTerminalJobOptions([]);
      return;
    }
    const ids =
      terminalMode === "personal"
        ? parseAssignedTerminalJobIds(employeeDocSelf)
        : parseAssignedTerminalJobIds(activeEmployee);
    if (ids.length === 0) {
      setTerminalJobOptions([]);
      return;
    }
    let cancelled = false;
    setTerminalJobsLoading(true);
    void (async () => {
      try {
        const chunks = chunkArray(ids, 10);
        const out: { id: string; name: string }[] = [];
        for (const ch of chunks) {
          const snap = await getDocs(
            query(
              collection(firestore, "companies", effectiveCompanyId, "jobs"),
              where(documentId(), "in", ch)
            )
          );
          snap.forEach((d) => {
            const data = d.data() as { name?: string };
            out.push({
              id: d.id,
              name: typeof data.name === "string" ? data.name.trim() || d.id : d.id,
            });
          });
        }
        if (!cancelled) setTerminalJobOptions(out);
      } catch (e) {
        console.error("[AttendanceTerminal] terminal jobs load", e);
        if (!cancelled) setTerminalJobOptions([]);
      } finally {
        if (!cancelled) setTerminalJobsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    firestore,
    effectiveCompanyId,
    terminalMode,
    employeeDocSelf,
    activeEmployee,
  ]);

  useEffect(() => {
    const handler = (err: FirestorePermissionError) => {
      const path = err.request?.path ?? "";
      if (path.includes("attendance")) {
        toast({
          variant: "destructive",
          title: "Záznam se nepodařilo uložit. Zkontrolujte oprávnění.",
        });
      }
    };
    errorEmitter.on("permission-error", handler);
    return () => errorEmitter.off("permission-error", handler);
  }, [toast]);

  const updateAttendanceStatus = useCallback((history: unknown[]) => {
    try {
      if (!Array.isArray(history) || history.length === 0) return;
      const latest = history[0];
      if (latest && typeof latest === "object" && "type" in latest) {
        setLastAction(latest.type as AttendanceType);
      }

      const checkInDoc = history.find(
        (a: any) => a && a.type === "check_in"
      ) as { timestamp?: unknown } | undefined;
      const checkOutDoc = history.find(
        (a: any) => a && a.type === "check_out"
      ) as { timestamp?: unknown } | undefined;

      const formatTime = (ts: unknown) => {
        const t = ts as { toDate?: () => Date } | undefined;
        return t?.toDate
          ? t.toDate().toLocaleTimeString("cs-CZ", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "--:--";
      };

      setTodaySummary({
        checkIn: formatTime(checkInDoc?.timestamp),
        checkOut: formatTime(checkOutDoc?.timestamp),
        worked: "7h 45m",
      });
    } catch (e) {
      console.error("[AttendanceTerminal] updateAttendanceStatus:", e);
      setTodaySummary({
        checkIn: "--:--",
        checkOut: "--:--",
        worked: "0h 0m",
      });
    }
  }, []);

  useEffect(() => {
    try {
      if (
        terminalMode === "personal" &&
        !attendanceError &&
        todayAttendance.length > 0
      ) {
        updateAttendanceStatus(todayAttendance);
      }
    } catch (e) {
      console.error("[AttendanceTerminal] attendance sync effect:", e);
    }
  }, [
    todayAttendance,
    terminalMode,
    attendanceError,
    updateAttendanceStatus,
  ]);

  const handlePinPress = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      if (newPin.length === 4) {
        lookupEmployeeByPin(newPin);
      }
    }
  };

  const handleClear = () => {
    setPin("");
    setActiveEmployee(null);
    setLastAction(null);
    void stopScanner();
  };

  const lookupEmployeeByPin = (code: string) => {
    try {
      const emp = employees.find((e: any) => e?.attendancePin === code);
      if (emp) {
        setActiveEmployee(emp);
        toast({
          title: `Vítejte, ${emp.firstName}!`,
          duration: 2000,
        });
      } else {
        setPin("");
        toast({
          variant: "destructive",
          title: "Neplatný PIN",
          duration: 2000,
        });
      }
    } catch (e) {
      console.error("[AttendanceTerminal] lookupEmployeeByPin:", e);
      setPin("");
    }
  };

  const lookupEmployeeByQr = (qrId: string) => {
    try {
      const emp = employees.find((e: any) => e?.attendanceQrId === qrId);
      if (emp) {
        setActiveEmployee(emp);
        toast({
          title: `Nalezen zaměstnanec: ${emp.firstName}`,
          duration: 2000,
        });
        void stopScanner();
      } else {
        toast({
          variant: "destructive",
          title: "QR kód nebyl rozpoznán",
          duration: 2000,
        });
      }
    } catch (e) {
      console.error("[AttendanceTerminal] lookupEmployeeByQr:", e);
    }
  };

  const startScanner = async () => {
    if (!isClient) return;
    setIsScanning(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;

      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          lookupEmployeeByQr(decodedText);
        },
        () => {}
      );
    } catch (err) {
      console.error("[AttendanceTerminal] startScanner:", err);
      toast({
        variant: "destructive",
        title: "Chyba při přístupu ke kameře",
      });
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    try {
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      }
    } catch (e) {
      console.error("[AttendanceTerminal] stopScanner:", e);
    }
    setIsScanning(false);
  };

  const handleAction = (
    type: AttendanceType,
    jobId?: string | null,
    jobName?: string | null
  ) => {
    try {
      const targetId =
        terminalMode !== "personal"
          ? activeEmployee?.id
          : profileEmployeeId || user?.uid;
      const targetName =
        terminalMode !== "personal"
          ? `${activeEmployee?.firstName} ${activeEmployee?.lastName}`
          : profile?.displayName || user?.email;

      if (!firestore || !effectiveCompanyId || !targetId) {
        console.warn(
          "[AttendanceTerminal] handleAction skipped — missing firestore/companyId/targetId"
        );
        toast({
          variant: "destructive",
          title: "Nelze uložit",
          description: "Chybí připojení k databázi nebo údaje o firmě.",
        });
        return;
      }

      const colRef = collection(
        firestore,
        "companies",
        effectiveCompanyId,
        "attendance"
      );
      const payload: Record<string, unknown> = {
        employeeId: targetId,
        employeeName: targetName,
        type,
        timestamp: serverTimestamp(),
        date: new Date().toISOString().split("T")[0],
        terminalId: standalone
          ? employeeTokenEntry
            ? "employee-token-web"
            : kioskTokenSession
              ? `token-kiosk-${terminalMode}`
              : `tablet-kiosk-${terminalMode}`
          : terminalMode === "pin"
            ? "shared-pin-terminal"
            : terminalMode === "qr"
              ? "qr-scanner-terminal"
              : "mobile-personal",
      };
      if (type === "check_in" && jobId) {
        payload.jobId = jobId;
        payload.jobName = jobName || "";
      }
      addDocumentNonBlocking(colRef, payload);

      const messages: Record<AttendanceType, string> = {
        check_in: "Příchod zaznamenán",
        break_start: "Pauza zahájena",
        break_end: "Pauza ukončena",
        check_out: "Odchod zaznamenán",
      };

      toast({ title: messages[type], duration: 2000 });

      if (terminalMode !== "personal") {
        setTimeout(handleClear, 1500);
      }
    } catch (e) {
      console.error("[AttendanceTerminal] handleAction:", e);
      toast({
        variant: "destructive",
        title: "Akci se nepodařilo provést.",
      });
    }
  };

  const initiateCheckIn = () => {
    const ids =
      terminalMode === "personal"
        ? parseAssignedTerminalJobIds(employeeDocSelf)
        : parseAssignedTerminalJobIds(activeEmployee);
    if (ids.length > 0) {
      setJobPickOpen(true);
    } else {
      handleAction("check_in", null, null);
    }
  };

  const shellClass = standalone
    ? "fixed inset-0 z-40 min-h-dvh w-full overflow-y-auto bg-background flex flex-col touch-manipulation"
    : "min-h-screen bg-background flex flex-col";

  const handleStandaloneLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !loginEmail.trim() || !loginPassword) {
      toast({
        variant: "destructive",
        title: "Neplatné přihlášení",
        description: "Zadejte e-mail a heslo.",
      });
      return;
    }
    setLoginLoading(true);
    try {
      await signInWithEmailAndPassword(
        auth,
        loginEmail.trim().toLowerCase(),
        loginPassword
      );
      toast({ title: "Přihlášení úspěšné" });
    } catch (err) {
      const code = (err as AuthError)?.code;
      toast({
        variant: "destructive",
        title: "Neplatné přihlášení",
        description:
          code === "auth/invalid-credential" || code === "auth/wrong-password"
            ? "Špatný e-mail nebo heslo."
            : "Přihlášení se nepodařilo.",
      });
    } finally {
      setLoginLoading(false);
    }
  };

  if (!user) {
    if (standalone) {
      return (
        <div className={shellClass}>
          <div className="flex flex-1 flex-col items-center justify-center p-6 w-full max-w-lg mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mb-6 shadow-lg">
              <Smartphone className="text-white w-9 h-9" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-center mb-2">
              Docházkový terminál
            </h1>
            <p className="text-muted-foreground text-center mb-8 text-lg">
              Přihlaste se účtem firmy (stejně jako v portálu).
            </p>
            <form
              onSubmit={handleStandaloneLogin}
              className="w-full space-y-4 max-w-md"
            >
              <div className="space-y-2">
                <Label htmlFor="term-email" className="text-base">
                  E-mail
                </Label>
                <Input
                  id="term-email"
                  type="email"
                  autoComplete="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="h-14 text-lg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="term-pass" className="text-base">
                  Heslo
                </Label>
                <Input
                  id="term-pass"
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="h-14 text-lg"
                />
              </div>
              <Button
                type="submit"
                disabled={loginLoading}
                className="w-full h-14 text-lg font-semibold"
              >
                {loginLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  "Přihlásit se"
                )}
              </Button>
            </form>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 max-w-md mx-auto">
        <Loader2 className="w-10 h-10 animate-spin text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground text-center">
          Kontrola přihlášení…
        </p>
        <Button
          variant="link"
          className="mt-4 text-xs"
          onClick={() => router.push("/login")}
        >
          Přihlásit se
        </Button>
      </div>
    );
  }

  if (!isKioskSession && !profileLoading && profile && companyAccessDenied) {
    return (
      <div
        className={
          standalone
            ? `${shellClass} flex flex-col items-stretch p-6 md:p-10`
            : "min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-md mx-auto min-w-0"
        }
      >
        <div className="flex flex-col items-center justify-center flex-1 max-w-md mx-auto gap-6 w-full">
          <Alert variant="destructive" className="w-full">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Nemáte oprávnění</AlertTitle>
            <AlertDescription>
              Tento terminál je nastaven pro jinou firmu než váš účet. Odhlaste se a
              přihlaste se účtem příslušné firmy.
            </AlertDescription>
          </Alert>
          <Button
            onClick={() => signOut(auth)}
            className="gap-2 min-h-14 text-lg w-full max-w-sm"
          >
            <LogOut className="w-5 h-5" /> Odhlásit se
          </Button>
          {!standalone && !employeeTokenEntry && (
            <Button
              variant="link"
              onClick={() => router.push("/portal/dashboard")}
              className="text-muted-foreground"
            >
              Zpět do portálu <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (profileLoading && !(isKioskSession && effectiveCompanyId)) {
    return (
      <div className="min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-md mx-auto min-w-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
              <Smartphone className="text-white w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight truncate">
                {displayCompanyName || `${PLATFORM_NAME} · terminál`}
              </h1>
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">
                Načítání…
              </p>
            </div>
          </div>
        </div>
        <Card className="border-primary/20 shadow-2xl mb-6 overflow-hidden relative">
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
        <div className="flex-1 flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-4 text-muted-foreground">
            <Loader2 className="w-10 h-10 animate-spin" />
            <p className="text-sm font-medium">Načítání profilu…</p>
          </div>
        </div>
        {!standalone && !employeeTokenEntry && (
          <Button
            variant="link"
            onClick={() => router.push("/portal/dashboard")}
            className="text-xs text-muted-foreground mt-4 w-fit"
          >
            Zpět do portálu{" "}
            <ChevronRight className="w-3 h-3 ml-1 shrink-0" />
          </Button>
        )}
      </div>
    );
  }

  if (profileError && !isKioskSession) {
    return (
      <div className="min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-md mx-auto min-w-0">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 shrink-0 bg-primary rounded-lg flex items-center justify-center">
            <Smartphone className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold truncate">
            {displayCompanyName || `${PLATFORM_NAME} · terminál`}
          </h1>
        </div>
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Profil se nepodařilo načíst</AlertTitle>
          <AlertDescription>
            Nemáme přístup k vašim údajům (např. oprávnění Firestore). Zkuste se
            odhlásit a přihlásit znovu, nebo kontaktujte administrátora.
          </AlertDescription>
        </Alert>
        <div className="flex flex-col gap-3 mt-auto">
          <Button
            variant="outline"
            onClick={() => signOut(auth)}
            className="gap-2 min-h-[44px]"
          >
            <LogOut className="w-4 h-4" /> Odhlásit se
          </Button>
          {!standalone && (
            <Button
              variant="link"
              onClick={() => router.push("/portal/dashboard")}
              className="text-muted-foreground"
            >
              Zpět do portálu <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (effectiveCompanyId && companyDocError) {
    return (
      <div className="min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-md mx-auto min-w-0">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 shrink-0 bg-primary rounded-lg flex items-center justify-center">
            <Smartphone className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold truncate">
            {displayCompanyName || `${PLATFORM_NAME} · terminál`}
          </h1>
        </div>
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Firmu se nepodařilo načíst</AlertTitle>
          <AlertDescription>
            Nemáme přístup k údajům firmy (např. oprávnění Firestore na cestě{" "}
            <span className="font-mono text-xs break-all">
              companies/{effectiveCompanyId}
            </span>
            ). Zkuste to znovu později nebo kontaktujte administrátora.
          </AlertDescription>
        </Alert>
        <div className="flex flex-col gap-3 mt-auto">
          <Button
            variant="outline"
            onClick={() => signOut(auth)}
            className="gap-2 min-h-[44px]"
          >
            <LogOut className="w-4 h-4" /> Odhlásit se
          </Button>
          {!standalone && (
            <Button
              variant="link"
              onClick={() => router.push("/portal/dashboard")}
              className="text-muted-foreground"
            >
              Zpět do portálu <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  if ((!profile || !effectiveCompanyId) && !isKioskSession) {
    return (
      <div className="min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-md mx-auto min-w-0">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 shrink-0 bg-primary rounded-lg flex items-center justify-center">
            <Smartphone className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold truncate">
            {displayCompanyName || `${PLATFORM_NAME} · terminál`}
          </h1>
        </div>
        <Alert className="mb-6">
          <Inbox className="h-4 w-4" />
          <AlertTitle>Profil nenalezen</AlertTitle>
          <AlertDescription>
            {!profile
              ? "Váš uživatelský profil v systému chybí."
              : "Nemáte přiřazenou firmu. Kontaktujte administrátora."}
          </AlertDescription>
        </Alert>
        <div className="flex flex-col gap-3 mt-auto">
          <Button
            variant="outline"
            onClick={() => signOut(auth)}
            className="gap-2 min-h-[44px]"
          >
            <LogOut className="w-4 h-4" /> Odhlásit se
          </Button>
          {!standalone && !employeeTokenEntry && (
            <Button
              variant="link"
              onClick={() => router.push("/portal/dashboard")}
              className="text-muted-foreground"
            >
              Zpět do portálu <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        standalone
          ? `${shellClass} flex flex-col p-4 md:p-8 max-w-3xl mx-auto w-full min-w-0`
          : "min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-md mx-auto min-w-0"
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 shrink-0 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
            <Smartphone className="text-white w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight truncate">
              {displayCompanyName || `${PLATFORM_NAME} · terminál`}
            </h1>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-tighter truncate">
              {displayCompanyName ? "Docházkový terminál" : effectiveCompanyId}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2">
          {!employeeTokenEntry && (
          <div className="flex gap-1 p-1 rounded-lg border border-border bg-muted/30">
            {!kioskTokenSession && (
              <Button
                variant={terminalMode === "personal" ? "default" : "ghost"}
                size="sm"
                className="min-h-[44px] flex-1 sm:flex-initial sm:h-7 sm:min-h-0 px-2 text-[10px] sm:text-[10px]"
                onClick={() => {
                  setTerminalMode("personal");
                  handleClear();
                }}
              >
                OSOBNÍ
              </Button>
            )}
            <Button
              variant={terminalMode === "pin" ? "default" : "ghost"}
              size="sm"
              className="min-h-[44px] flex-1 sm:flex-initial sm:h-7 sm:min-h-0 px-2 text-[10px]"
              onClick={() => {
                setTerminalMode("pin");
                handleClear();
              }}
            >
              PIN
            </Button>
            <Button
              variant={terminalMode === "qr" ? "default" : "ghost"}
              size="sm"
              className="min-h-[44px] flex-1 sm:flex-initial sm:h-7 sm:min-h-0 px-2 text-[10px]"
              onClick={() => {
                setTerminalMode("qr");
                handleClear();
              }}
            >
              QR
            </Button>
          </div>
          )}
          {terminalMode === "personal" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut(auth)}
              className="min-h-[44px] sm:min-h-0 text-xs text-muted-foreground hover:text-destructive touch-manipulation"
            >
              Odhlásit <LogOut className="w-3 h-3 ml-1 shrink-0" />
            </Button>
          )}
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

      {profileEmployeeId && employeeSelfError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Záznam zaměstnance nelze načíst</AlertTitle>
          <AlertDescription>
            Oprávnění k dokumentu zaměstnance jsou omezená. Docházku můžete
            zapisovat, pokud máte přístup k kolekci docházky.
          </AlertDescription>
        </Alert>
      )}

      {terminalMode === "personal" && attendanceError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Dnešní docházku nelze načíst</AlertTitle>
          <AlertDescription>
            Oprávnění k záznamům docházky jsou omezená. Příchod a odchod stále
            můžete zapisovat.
          </AlertDescription>
        </Alert>
      )}

      {terminalMode === "personal" && attendanceLoading && !attendanceError && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Načítání dnešní docházky…
        </div>
      )}

      {terminalMode === "pin" && !activeEmployee && (
        <div className="flex-1 flex flex-col items-center">
          {employeesError && (
            <Alert variant="destructive" className="mb-4 w-full max-w-[280px]">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Seznam zaměstnanců není k dispozici</AlertTitle>
              <AlertDescription>
                Načtení zaměstnanců selhalo (např. oprávnění Firestore). Zkuste
                režim Osobní nebo kontaktujte administrátora.
              </AlertDescription>
            </Alert>
          )}
          {employeesLoading && !employeesError && (
            <div className="flex items-center gap-2 text-muted-foreground mb-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Načítání zaměstnanců…</span>
            </div>
          )}
          <div className="w-full max-w-[280px] space-y-6">
            <div className="text-center">
              <h2 className="text-lg font-bold mb-1">Zadejte svůj PIN</h2>
              <div className="flex justify-center gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full border-2 border-primary ${
                      pin.length > i ? "bg-primary" : "bg-transparent"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                "1",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
                "C",
                "0",
                "DEL",
              ].map((val) => (
                <Button
                  key={val}
                  variant={val === "C" || val === "DEL" ? "outline" : "default"}
                  className={`${standalone ? "h-20 min-h-[5rem] text-2xl" : "h-16 text-xl"} font-bold rounded-xl ${
                    val === "DEL" ? "text-rose-500 border-rose-500/20" : ""
                  }`}
                  onClick={() => {
                    if (val === "C") handleClear();
                    else if (val === "DEL") setPin(pin.slice(0, -1));
                    else handlePinPress(val);
                  }}
                >
                  {val === "DEL" ? <Delete className="w-6 h-6" /> : val}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {terminalMode === "qr" && !activeEmployee && (
        <div className="flex-1 flex flex-col items-center space-y-6">
          {employeesError && (
            <Alert variant="destructive" className="w-full max-w-[300px]">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Seznam zaměstnanců není k dispozici</AlertTitle>
              <AlertDescription>
                Načtení zaměstnanců selhalo (např. oprávnění Firestore). Zkuste
                režim Osobní nebo kontaktujte administrátora.
              </AlertDescription>
            </Alert>
          )}
          {employeesLoading && !employeesError && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Načítání zaměstnanců…</span>
            </div>
          )}
          <div className="text-center">
            <h2 className="text-lg font-bold">Naskenujte QR kód</h2>
            <p className="text-sm text-muted-foreground">
              Namířte kameru na svůj docházkový kód
            </p>
          </div>

          <div className="w-full aspect-square max-w-[300px] bg-black rounded-2xl overflow-hidden border-2 border-primary/50 relative shadow-2xl">
            <div id="reader" className="w-full h-full" />
            {!isScanning && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <Button onClick={() => void startScanner()} className="gap-2">
                  <Camera className="w-4 h-4" /> Spustit skener
                </Button>
              </div>
            )}
            {isScanning && (
              <div className="absolute top-0 left-0 w-full h-1 bg-primary animate-bounce" />
            )}
          </div>

          {isScanning && (
            <Button
              variant="ghost"
              onClick={() => void stopScanner()}
              className="text-muted-foreground"
            >
              Zrušit skenování
            </Button>
          )}
        </div>
      )}

      {(terminalMode === "personal" || activeEmployee) && (
        <>
          <div className="flex items-center gap-4 mb-6 p-4 rounded-2xl bg-surface/50 border border-border">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <User className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">
                {terminalMode !== "personal"
                  ? `${activeEmployee?.firstName} ${activeEmployee?.lastName}`
                  : profile?.displayName || user.email}
              </p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <p className="text-xs text-muted-foreground capitalize truncate">
                  {terminalMode !== "personal"
                    ? activeEmployee?.jobTitle
                    : profile?.role || "Zaměstnanec"}
                </p>
              </div>
            </div>
            {terminalMode !== "personal" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClear}
                className="text-muted-foreground shrink-0"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 mb-6">
            <Button
              disabled={
                lastAction === "check_in" || lastAction === "break_end"
              }
              onClick={() => initiateCheckIn()}
              className={`${standalone ? "min-h-[5.5rem] text-2xl" : "h-20 text-xl"} font-bold rounded-2xl shadow-lg bg-emerald-600 hover:bg-emerald-700 transition-all gap-4`}
            >
              <Play className="w-6 h-6 fill-white" /> Přihlásit příchod
            </Button>

            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                disabled={
                  lastAction !== "check_in" && lastAction !== "break_end"
                }
                onClick={() => handleAction("break_start")}
                className={`${standalone ? "min-h-[5rem] text-xl" : "h-20 text-lg"} font-bold rounded-2xl border-amber-500/50 text-amber-500 hover:bg-amber-500/10 gap-2`}
              >
                <Coffee className="w-5 h-5" /> Pauza
              </Button>
              <Button
                variant="outline"
                disabled={lastAction !== "break_start"}
                onClick={() => handleAction("break_end")}
                className={`${standalone ? "min-h-[5rem] text-xl" : "h-20 text-lg"} font-bold rounded-2xl border-blue-500/50 text-blue-500 hover:bg-blue-500/10 gap-2`}
              >
                <Timer className="w-5 h-5" /> Konec pauzy
              </Button>
            </div>

            <Button
              variant="destructive"
              disabled={
                lastAction === "check_out" ||
                !lastAction ||
                lastAction === "break_start"
              }
              onClick={() => handleAction("check_out")}
              className={`${standalone ? "min-h-[5.5rem] text-2xl" : "h-20 text-xl"} font-bold rounded-2xl shadow-lg transition-all gap-4`}
            >
              <Square className="w-6 h-6 fill-white" /> Odhlásit odchod
            </Button>
          </div>

          {terminalMode === "personal" && (
            <Card className="bg-surface/30 border-border mt-auto">
              <CardHeader className="py-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Timer className="w-4 h-4 text-primary" /> Dnešní přehled
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2 pb-6">
                <div className="text-center p-2 rounded-xl bg-background/50 border border-border">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">
                    Příchod
                  </p>
                  <p className="text-sm font-bold text-emerald-500">
                    {todaySummary.checkIn}
                  </p>
                </div>
                <div className="text-center p-2 rounded-xl bg-background/50 border border-border">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">
                    Odchod
                  </p>
                  <p className="text-sm font-bold text-rose-500">
                    {todaySummary.checkOut}
                  </p>
                </div>
                <div className="text-center p-2 rounded-xl bg-background/50 border border-border">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">
                    Odpracováno
                  </p>
                  <p className="text-sm font-bold text-primary">
                    {todaySummary.worked}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={jobPickOpen} onOpenChange={setJobPickOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border border-border bg-background text-foreground sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl text-foreground">
              Zakázka pro příchod
            </DialogTitle>
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
                  className="min-h-[4.5rem] flex-col justify-center gap-1 border-border py-4 text-lg text-foreground hover:bg-muted/50"
                  onClick={() => {
                    handleAction("check_in", j.id, j.name);
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

      {terminalMode === "personal" && !standalone && !employeeTokenEntry && (
        <Button
          variant="link"
          onClick={() => router.push("/portal/dashboard")}
          className="text-xs text-muted-foreground mt-4"
        >
          Zpět do portálu <ChevronRight className="w-3 h-3 ml-1" />
        </Button>
      )}
    </div>
  );
}
