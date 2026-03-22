"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/firebase";
import { signInWithCustomToken } from "firebase/auth";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function TerminalAccessPage() {
  const params = useParams();
  const router = useRouter();
  const auth = useAuth();
  const token = typeof params?.token === "string" ? params.token.trim() : "";

  const [state, setState] = useState<"loading" | "error" | "done">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!token) {
      setErrorMsg("Neplatný terminálový odkaz");
      setState("error");
      return;
    }
    if (!auth) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/terminal-access/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          customToken?: string;
          companyId?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setErrorMsg(data?.error || "Neplatný terminálový odkaz");
          setState("error");
          return;
        }
        const customToken = data.customToken;
        const companyId = data.companyId?.trim();
        if (!customToken || !companyId) {
          setErrorMsg("Neplatný terminálový odkaz");
          setState("error");
          return;
        }
        await signInWithCustomToken(auth, customToken);
        if (cancelled) return;
        setState("done");
        router.replace(
          `/portal/attendance/terminal?company=${encodeURIComponent(companyId)}`
        );
      } catch (e) {
        console.error("[terminal-access]", e);
        if (!cancelled) {
          setErrorMsg("Přihlášení se nezdařilo. Zkuste to znovu.");
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, auth, router, retryKey]);

  if (!token) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-background">
        <Alert variant="destructive" className="max-w-md w-full">
          <AlertCircle className="h-6 w-6 shrink-0" />
          <AlertTitle className="text-lg">Neplatný terminálový odkaz</AlertTitle>
          <AlertDescription className="text-base">
            V adrese chybí platný token.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background p-6">
        <div className="flex flex-col items-center gap-4 text-muted-foreground max-w-sm text-center">
          <Loader2 className="w-14 h-14 animate-spin text-primary" />
          <p className="text-lg font-medium">Připojování…</p>
        </div>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="min-h-dvh grid place-items-center bg-background p-6 safe-area-pb">
        <div className="flex flex-col items-center gap-4 text-muted-foreground max-w-sm text-center">
          <Loader2 className="w-14 h-14 animate-spin text-primary" />
          <p className="text-lg font-medium leading-snug">
            Přihlašuji docházkový terminál…
          </p>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-background safe-area-pb">
        <Alert variant="destructive" className="max-w-md w-full">
          <AlertCircle className="h-6 w-6 shrink-0" />
          <AlertTitle className="text-lg">Neplatný terminálový odkaz</AlertTitle>
          <AlertDescription className="text-base">
            {errorMsg || "Odkaz není platný nebo byl zneplatněn."}
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          className="mt-8 min-h-[52px] w-full max-w-md text-base touch-manipulation"
          onClick={() => {
            setState("loading");
            setErrorMsg(null);
            setRetryKey((k) => k + 1);
          }}
        >
          Zkusit znovu
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh grid place-items-center bg-background p-6">
      <Loader2 className="w-12 h-12 animate-spin text-primary" />
    </div>
  );
}
