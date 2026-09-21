"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  DEFAULT_PLATFORM_AI_BRANDING,
  type PlatformAiBranding,
} from "@/lib/platform-ai-branding-shared";

type Ctx = {
  branding: PlatformAiBranding;
  loading: boolean;
  refresh: () => Promise<void>;
};

const PlatformAiBrandingContext = createContext<Ctx>({
  branding: DEFAULT_PLATFORM_AI_BRANDING,
  loading: true,
  refresh: async () => {},
});

export function PlatformAiBrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<PlatformAiBranding>(DEFAULT_PLATFORM_AI_BRANDING);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/ai-branding", { cache: "no-store" });
      const data = await res.json();
      if (data.ok && data.branding) {
        setBranding({ ...DEFAULT_PLATFORM_AI_BRANDING, ...data.branding });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return (
    <PlatformAiBrandingContext.Provider value={{ branding, loading, refresh }}>
      {children}
    </PlatformAiBrandingContext.Provider>
  );
}

export function usePlatformAiBranding() {
  return useContext(PlatformAiBrandingContext);
}
