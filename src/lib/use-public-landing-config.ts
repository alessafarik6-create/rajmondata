"use client";

import { useEffect, useState } from "react";
import type { PlatformSeoHeroImage, PlatformSeoPromoVideo } from "@/lib/platform-seo-sanitize";

export type PublicLandingConfig = {
  settings?: {
    defaultEmployeePriceCzk?: number;
    landingHeadline?: string;
    landingSubline?: string;
    promoNote?: string;
  };
  seo?: {
    metaTitle?: string;
    metaDescription?: string;
    keywords?: string;
    landingLead?: string;
    heroTitle?: string;
    heroSubtitle?: string;
    registerButtonText?: string;
    loginButtonText?: string;
    benefitsTitle?: string;
    benefitsText?: string;
    pricingTitle?: string;
    pricingSubtitle?: string;
    registerPageTitle?: string;
    registerPageSubtitle?: string;
    registerPageHelperText?: string;
    loginPageTitle?: string;
    loginPageSubtitle?: string;
    loginWelcomeText?: string;
    loginEmailLabel?: string;
    loginPasswordLabel?: string;
    heroImages?: PlatformSeoHeroImage[];
    promoVideo?: PlatformSeoPromoVideo | null;
    registerImages?: PlatformSeoHeroImage[];
    registerVideo?: PlatformSeoPromoVideo | null;
    loginImages?: PlatformSeoHeroImage[];
    loginVideo?: PlatformSeoPromoVideo | null;
  };
  modules?: Array<{
    code?: string;
    name?: string;
    description?: string;
    basePriceCzk?: number;
    employeePriceCzk?: number;
    priceMonthly?: number;
    billingType?: string;
  }>;
  error?: string;
};

/**
 * Načte `/api/public/landing-config` (settings + SEO + moduly) pro veřejné stránky.
 */
export function usePublicLandingConfig() {
  const [data, setData] = useState<PublicLandingConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/landing-config", { cache: "no-store" });
        const j = (await res.json().catch(() => ({}))) as PublicLandingConfig;
        if (!cancelled) {
          setData(j);
          setErr(null);
        }
      } catch {
        if (!cancelled) {
          setErr("Nepodařilo se načíst nastavení stránky.");
        }
      } finally {
        if (!cancelled) setDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, err, done };
}
