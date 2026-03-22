"use client";

import React, {
  Component,
  Suspense,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useCompany, useUser } from "@/firebase";
import { AttendanceTerminal } from "@/components/attendance/AttendanceTerminal";
import { TerminalTabletLinkSection } from "@/components/terminal/terminal-tablet-link-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2 } from "lucide-react";

type BoundaryProps = { children: ReactNode };
type BoundaryState = { error: Error | null };

class AttendanceTerminalErrorBoundary extends Component<
  BoundaryProps,
  BoundaryState
> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "[AttendanceTerminal] render error:",
      error.message,
      info.componentStack
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 max-w-lg mx-auto">
          <Alert variant="destructive" className="w-full">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Terminál se nepodařilo zobrazit</AlertTitle>
            <AlertDescription className="break-words">
              {this.state.error.message}
            </AlertDescription>
          </Alert>
          <Button
            type="button"
            variant="outline"
            className="mt-6"
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

/** Portálový terminál — firma výhradně z `users/{uid}.companyId`, žádný `?company=`. */
function PortalAttendanceTerminalInner() {
  const { user } = useUser();
  const { userProfile: profile, companyId, isLoading } = useCompany();

  const role = (profile as { role?: string } | null)?.role ?? "employee";
  const canManage =
    role === "owner" ||
    role === "admin" ||
    role === "manager" ||
    role === "accountant";

  if (!user) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertTitle>Nejste přihlášeni</AlertTitle>
        <AlertDescription>Pro terminál se přihlaste do portálu.</AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span>Načítání…</span>
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertTitle>Uživatel nemá přiřazenou firmu</AlertTitle>
        <AlertDescription>V profilu chybí companyId.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col w-full">
      <div className="w-full max-w-3xl mx-auto px-4 pt-6 pb-4 md:px-8 md:pt-8 shrink-0">
        <TerminalTabletLinkSection companyId={companyId} canManage={canManage} />
      </div>
      <div className="flex-1 flex flex-col w-full max-w-md mx-auto px-4 pb-8 md:px-8 min-h-0">
        <AttendanceTerminal />
      </div>
    </div>
  );
}

function TerminalPageFallback() {
  const [showTimeout, setShowTimeout] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShowTimeout(true), 8000);
    return () => window.clearTimeout(id);
  }, []);
  if (showTimeout) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center gap-4 p-6 text-muted-foreground max-w-md mx-auto">
        <Alert variant="destructive" className="w-full">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Načítání trvá příliš dlouho</AlertTitle>
          <AlertDescription>Zkuste obnovit stránku.</AlertDescription>
        </Alert>
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          Obnovit stránku
        </Button>
      </div>
    );
  }
  return (
    <div className="min-h-[40vh] flex items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="w-8 h-8 animate-spin" />
      <span>Načítání…</span>
    </div>
  );
}

export default function PortalAttendanceTerminalPage() {
  return (
    <AttendanceTerminalErrorBoundary>
      <Suspense fallback={<TerminalPageFallback />}>
        <PortalAttendanceTerminalInner />
      </Suspense>
    </AttendanceTerminalErrorBoundary>
  );
}
