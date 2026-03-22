"use client";

import {
  Component,
  Suspense,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PublicTerminalApp } from "@/components/terminal/PublicTerminalApp";

const BOOTSTRAP_TIMEOUT_MS = 8000;

/**
 * `/terminal` – žádný Firebase Auth na klientovi (žádný useFirebase / useUser).
 * Konfigurace firmy jen přes GET /api/terminal/config (Admin SDK na serveru).
 */
function TerminalBootstrapLog() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("[terminal] Terminal auth creation disabled");
      console.log("[terminal] Terminal uses PIN session only");
      console.log("[terminal] No Firebase auth user is created on /terminal");
    }
  }, []);
  return null;
}

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
    const id = window.setTimeout(() => setShowTimeout(true), BOOTSTRAP_TIMEOUT_MS);
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
  const [phase, setPhase] = useState<"init" | "loading" | "ready" | "error">("init");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [bootstrapTimedOut, setBootstrapTimedOut] = useState(false);

  useEffect(() => {
    if (phase !== "loading" && phase !== "init") return;
    const id = window.setTimeout(() => setBootstrapTimedOut(true), BOOTSTRAP_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [phase, retryKey]);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setErrorMsg(null);
    setBootstrapTimedOut(false);

    void (async () => {
      try {
        const res = await fetch("/api/terminal/config");
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          companyId?: string;
          companyName?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setErrorMsg(
            data?.error ||
              (res.status === 503
                ? "Firma nebyla nalezena nebo chybí aktivní záznam v terminálOdkazy (případně TERMINAL_COMPANY_ID / config/terminal)."
                : "Terminál nelze spustit.")
          );
          setPhase("error");
          return;
        }
        const cid = data.companyId?.trim();
        const cname = typeof data.companyName === "string" ? data.companyName.trim() : "";
        if (!cid) {
          setErrorMsg("Neplatná odpověď serveru.");
          setPhase("error");
          return;
        }
        if (cancelled) return;
        setCompanyId(cid);
        setCompanyName(cname || null);
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
  }, [retryKey]);

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

  if ((phase === "loading" || phase === "init") && bootstrapTimedOut) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 bg-background safe-area-pb gap-4">
        <Alert variant="destructive" className="max-w-md w-full">
          <AlertCircle className="h-6 w-6 shrink-0" />
          <AlertTitle className="text-lg">Načítání trvá příliš dlouho</AlertTitle>
          <AlertDescription>Zkuste obnovit stránku.</AlertDescription>
        </Alert>
        <Button type="button" variant="outline" className="min-h-[48px]" onClick={() => window.location.reload()}>
          Obnovit stránku
        </Button>
      </div>
    );
  }

  if (phase === "loading" || phase === "init") {
    return (
      <div className="flex flex-1 grid place-items-center bg-background p-6 safe-area-pb">
        <div className="flex flex-col items-center gap-4 text-muted-foreground max-w-sm text-center">
          <Loader2 className="w-14 h-14 animate-spin text-primary" />
          <p className="text-lg font-medium leading-snug">Načítání terminálu…</p>
        </div>
      </div>
    );
  }

  if (phase === "ready" && companyId) {
    return (
      <div className="flex flex-1 flex-col min-h-0 w-full overflow-hidden">
        <TerminalBootstrapLog />
        <AttendanceTerminalErrorBoundary>
          <Suspense fallback={<TerminalFallback />}>
            <PublicTerminalApp companyId={companyId} companyName={companyName} />
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
