"use client";

import {
  Component,
  Suspense,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useFirebase } from "@/firebase";
import { signInWithCustomToken } from "firebase/auth";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AttendanceTerminal } from "@/components/attendance/AttendanceTerminal";

type BoundaryProps = { children: ReactNode };
type BoundaryState = { error: Error | null };

class AttendanceTerminalErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[terminal] render error:", error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-full flex flex-col items-center justify-center p-6 max-w-lg mx-auto">
          <Alert variant="destructive" className="w-full">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Terminál se nepodařilo zobrazit</AlertTitle>
            <AlertDescription className="break-words">{this.state.error.message}</AlertDescription>
          </Alert>
          <Button
            type="button"
            variant="outline"
            className="mt-6 min-h-[44px]"
            onClick={() => this.setState({ error: null })}
          >
            Zkusit znovu
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function TerminalFallback() {
  const [showTimeout, setShowTimeout] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShowTimeout(true), 12000);
    return () => window.clearTimeout(id);
  }, []);
  if (showTimeout) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-muted-foreground max-w-md mx-auto">
        <Alert variant="destructive" className="w-full">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Načítání trvá příliš dlouho</AlertTitle>
          <AlertDescription>
            Zkuste obnovit stránku. Pokud problém přetrvává, zkontrolujte připojení.
          </AlertDescription>
        </Alert>
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          Obnovit stránku
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground p-6">
      <Loader2 className="w-8 h-8 animate-spin" />
      <span>Načítání…</span>
    </div>
  );
}

function StandaloneTerminalInner() {
  const { auth, areServicesAvailable, firebaseConfigError } = useFirebase();

  const [phase, setPhase] = useState<"init" | "auth" | "ready" | "error">("init");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (firebaseConfigError) {
      setErrorMsg(firebaseConfigError);
      setPhase("error");
      return;
    }
    if (!auth || !areServicesAvailable) {
      setPhase("init");
      return;
    }

    let cancelled = false;
    setPhase("auth");
    setErrorMsg(null);

    void (async () => {
      try {
        const res = await fetch("/api/terminal/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          customToken?: string;
          companyId?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setErrorMsg(data?.error || "Terminál nelze spustit.");
          setPhase("error");
          return;
        }
        const customToken = data.customToken;
        const cid = data.companyId?.trim();
        if (!customToken || !cid) {
          setErrorMsg("Neplatná odpověď serveru.");
          setPhase("error");
          return;
        }
        await signInWithCustomToken(auth, customToken);
        if (cancelled) return;
        setCompanyId(cid);
        setPhase("ready");
      } catch (e) {
        console.error("[terminal]", e);
        if (!cancelled) {
          setErrorMsg("Připojení k terminálu se nezdařilo. Zkuste to znovu.");
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth, areServicesAvailable, firebaseConfigError, retryKey]);

  if (firebaseConfigError && phase !== "ready") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-md w-full">
          <AlertTitle>Chyba konfigurace</AlertTitle>
          <AlertDescription>{firebaseConfigError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 bg-background safe-area-pb">
        <Alert variant="destructive" className="max-w-md w-full">
          <AlertCircle className="h-6 w-6 shrink-0" />
          <AlertTitle className="text-lg">Terminál nelze spustit</AlertTitle>
          <AlertDescription className="text-base">
            {errorMsg || "Zkuste to znovu později."}
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          className="mt-8 min-h-[52px] w-full max-w-md text-base touch-manipulation"
          onClick={() => {
            setPhase("init");
            setErrorMsg(null);
            setRetryKey((k) => k + 1);
          }}
        >
          Zkusit znovu
        </Button>
      </div>
    );
  }

  if (!auth || !areServicesAvailable) {
    return (
      <div className="flex flex-1 grid place-items-center bg-background p-6">
        <div className="flex flex-col items-center gap-4 text-muted-foreground max-w-sm text-center">
          <Loader2 className="w-14 h-14 animate-spin text-primary" />
          <p className="text-lg font-medium">Připojování…</p>
        </div>
      </div>
    );
  }

  if (phase === "auth" || phase === "init") {
    return (
      <div className="flex flex-1 grid place-items-center bg-background p-6 safe-area-pb">
        <div className="flex flex-col items-center gap-4 text-muted-foreground max-w-sm text-center">
          <Loader2 className="w-14 h-14 animate-spin text-primary" />
          <p className="text-lg font-medium leading-snug">Spouštím terminál…</p>
        </div>
      </div>
    );
  }

  if (phase === "ready" && companyId) {
    return (
      <div className="flex flex-1 flex-col min-h-0 w-full overflow-hidden">
        <AttendanceTerminalErrorBoundary>
          <Suspense fallback={<TerminalFallback />}>
            <AttendanceTerminal
              standalone
              kioskTokenSession
              hidePortalLinks
              companyIdOverride={companyId}
            />
          </Suspense>
        </AttendanceTerminalErrorBoundary>
      </div>
    );
  }

  return (
    <div className="flex flex-1 grid place-items-center bg-background p-6">
      <Loader2 className="w-12 h-12 animate-spin text-primary" />
    </div>
  );
}

export default function TerminalPage() {
  return (
    <Suspense fallback={<TerminalFallback />}>
      <StandaloneTerminalInner />
    </Suspense>
  );
}
