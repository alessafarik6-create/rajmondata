"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  DEFAULT_PLATFORM_AI_BRANDING,
  type PlatformAiBranding,
} from "@/lib/platform-ai-branding-shared";

type Ctx = {
  branding: PlatformAiBranding;
  loading: boolean;
};

const PlatformAiBrandingContext = createContext<Ctx>({
  branding: DEFAULT_PLATFORM_AI_BRANDING,
  loading: true,
});

export function PlatformAiBrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<PlatformAiBranding>(DEFAULT_PLATFORM_AI_BRANDING);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/platform/ai-branding", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && data.ok && data.branding) {
          setBranding({ ...DEFAULT_PLATFORM_AI_BRANDING, ...data.branding });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PlatformAiBrandingContext.Provider value={{ branding, loading }}>
      {children}
    </PlatformAiBrandingContext.Provider>
  );
}

export function usePlatformAiBranding() {
  return useContext(PlatformAiBrandingContext);
}
