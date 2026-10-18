"use client";

import { useCallback, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { PlatformModuleCode } from "@/lib/platform-config";

export type ExternalModuleLaunchPhase = "idle" | "loading" | "success" | "error";

function mapLaunchError(raw: string, status?: number): string {
  const m = raw.toLowerCase();
  if (status === 401 || m.includes("neplatný token") || m.includes("authorization")) {
    return "Platnost přihlášení vypršela. Obnovte stránku (F5) a zkuste to znovu.";
  }
  if (status === 403) return raw || "Nemáte oprávnění spustit tento modul.";
  if (status === 503 || m.includes("portal_api_secret") || m.includes("hmac") || m.includes("unauthorized")) {
    return "Propojení s editorem selhalo (autentizace serveru). Kontaktujte správce platformy.";
  }
  if (status === 502 || status === 503 || m.includes("nedostup")) {
    return "Editor na Railway momentálně neodpovídá. Zkuste to znovu za chvíli.";
  }
  if (m.includes("synchronizace") || m.includes("sync")) {
    return "Synchronizace oprávnění s editorem neproběhla. Zkuste to znovu nebo kontaktujte podporu.";
  }
  return raw || "Spuštění editoru se nezdařilo.";
}

export function useExternalModuleLaunch(moduleCode: PlatformModuleCode) {
  const [phase, setPhase] = useState<ExternalModuleLaunchPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const launch = useCallback(
    async (user: User | null | undefined, opts?: { openInNewTab?: boolean; forceSameTab?: boolean }) => {
      if (!user) {
        setPhase("error");
        setError("Nejste přihlášeni.");
        return { ok: false as const };
      }
      if (inFlight.current) return { ok: false as const };
      inFlight.current = true;
      setPhase("loading");
      setError(null);
      try {
        const token = await user.getIdToken(true);
        const res = await fetch(`/api/company/modules/${encodeURIComponent(moduleCode)}/launch`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          redirectUrl?: string;
          error?: string;
          requestId?: string;
        };
        if (!res.ok) {
          const msg = mapLaunchError(String(data.error ?? ""), res.status);
          setPhase("error");
          setError(msg);
          return { ok: false as const, error: msg };
        }
        const url = String(data.redirectUrl ?? "").trim();
        if (!url) {
          const msg = "Chybí adresa pro spuštění editoru.";
          setPhase("error");
          setError(msg);
          return { ok: false as const, error: msg };
        }
        const openInNewTab = opts?.forceSameTab ? false : opts?.openInNewTab !== false;
        if (openInNewTab) {
          const opened = window.open(url, "_blank", "noopener,noreferrer");
          if (!opened) {
            window.location.assign(url);
          }
        } else {
          window.location.assign(url);
        }
        setPhase("success");
        return { ok: true as const, redirectUrl: url };
      } catch (e) {
        const msg = mapLaunchError(e instanceof Error ? e.message : String(e));
        setPhase("error");
        setError(msg);
        return { ok: false as const, error: msg };
      } finally {
        inFlight.current = false;
      }
    },
    [moduleCode]
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
  }, []);

  return { phase, error, launch, reset, isLoading: phase === "loading" };
}
