"use client";

import React, { useMemo } from "react";
import { PublicAuthMediaPanel } from "@/components/marketing/public-auth-media-panel";
import { usePublicLandingConfig } from "@/lib/use-public-landing-config";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import type { PlatformSeoHeroImage, PlatformSeoPromoVideo } from "@/lib/platform-seo-sanitize";

type Props = {
  children: React.ReactNode;
  /** login | register — výběr médií z platform SEO */
  mediaVariant?: "login" | "register";
  mediaTitle?: string;
  mediaSubtitle?: string;
};

export function PublicAuthPageLayout({
  children,
  mediaVariant = "login",
  mediaTitle,
  mediaSubtitle,
}: Props) {
  const { data: landingCfg } = usePublicLandingConfig();
  const seo = landingCfg?.seo;

  const images = useMemo((): PlatformSeoHeroImage[] => {
    const raw = mediaVariant === "register" ? seo?.registerImages : seo?.loginImages;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x) => x && typeof (x as PlatformSeoHeroImage).url === "string") as PlatformSeoHeroImage[];
  }, [mediaVariant, seo?.loginImages, seo?.registerImages]);

  const video =
    (mediaVariant === "register"
      ? (seo?.registerVideo as PlatformSeoPromoVideo | null)
      : (seo?.loginVideo as PlatformSeoPromoVideo | null)) ?? null;

  const title =
    mediaTitle?.trim() ||
    (typeof seo?.loginPageTitle === "string" && seo.loginPageTitle.trim()) ||
    PLATFORM_NAME;

  const subtitle =
    mediaSubtitle?.trim() ||
    "Cloudová platforma pro týmy, zakázky a finance. Bezpečné přihlášení k portálu.";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="flex min-h-screen flex-col lg:grid lg:grid-cols-2">
        <div className="hidden min-h-0 w-full min-w-0 shrink-0 lg:block">
          <PublicAuthMediaPanel images={images} video={video} title={title} subtitle={subtitle} />
        </div>
        <div className="flex w-full min-w-0 items-center justify-center px-4 py-6 sm:px-5 sm:py-8 lg:px-8">
          {children}
        </div>
      </div>
    </div>
  );
}
