"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/firebase";
import { AttendanceTerminal } from "@/components/attendance/AttendanceTerminal";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function TerminalByTokenPage() {
  const params = useParams();
  const token = typeof params?.token === "string" ? params.token.trim() : "";
  const auth = useAuth();
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    if (!token) {
      setErrorMsg("V URL chybí platný token.");
      setState("error");
      return;
    }
    if (!auth) return;
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/terminal/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        companyId?: string;
      };
      if (!res.ok) {
        setErrorMsg(data?.error || "Nelze ověřit odkaz.");
        setState("error");
        return;
      }
      const cid = data.companyId?.trim();
      if (!cid) {
        setErrorMsg("Neplatná odpověď serveru.");
        setState("error");
        return;
      }
      setCompanyId(cid);
      setState("ready");
    } catch (e) {
      console.error("[terminal/token]", e);
      setErrorMsg("Chyba připojení. Zkuste to znovu.");
      setState("error");
    }
  }, [token, auth]);

  useEffect(() => {
    if (!token) {
      setErrorMsg("Neplatná adresa terminálu.");
      setState("error");
      return;
    }
    if (!auth) return;
    void bootstrap();
  }, [token, auth, bootstrap]);

  if (!auth || state === "idle" || state === "loading") {
    return (
      <div className="min-h-dvh grid place-items-center bg-background p-6">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
          <p className="text-lg font-medium">Ověřování odkazu terminálu…</p>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-background">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-5 w-5" />
          <AlertTitle>Terminál nelze otevřít</AlertTitle>
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
        <Button className="mt-6 min-h-12 text-base" onClick={() => void bootstrap()}>
          Zkusit znovu
        </Button>
      </div>
    );
  }

  if (!companyId) {
    return null;
  }

  return (
    <AttendanceTerminal
      standalone
      companyIdOverride={companyId}
      employeeTokenEntry
    />
  );
}
