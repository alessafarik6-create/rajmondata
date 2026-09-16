"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { PlatformSeoHeroImage } from "@/lib/platform-seo-sanitize";
import { usePublicLandingConfig } from "@/lib/use-public-landing-config";

export function PublicLandingHeroMedia() {
  const { data } = usePublicLandingConfig();
  const [heroIdx, setHeroIdx] = useState(0);

  const heroImages = useMemo(() => {
    const raw = data?.seo?.heroImages;
    if (!Array.isArray(raw)) return [];
    return [...raw]
      .filter((h): h is PlatformSeoHeroImage => !!h && typeof (h as PlatformSeoHeroImage).url === "string")
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [data?.seo?.heroImages]);

  useEffect(() => {
    if (heroImages.length <= 1) return;
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroImages.length), 6500);
    return () => clearInterval(t);
  }, [heroImages.length]);

  if (heroImages.length === 0) {
    return (
      <div
        className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-white/15 bg-slate-900/40 p-6 text-center text-sm text-slate-500 sm:min-h-[280px]"
        aria-hidden="true"
      >
        <span className="sr-only">Ilustrace portálu RAJMONDATA</span>
        Firemní portál RAJMONDATA — ukázka rozhraní
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-400 sm:text-sm">Ukázka portálu</p>
      <div className="relative max-h-[42dvh] w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-xl sm:max-h-[min(52dvh,520px)] lg:aspect-[4/3] lg:max-h-[min(78vh,640px)]">
        {heroImages.map((h, i) => (
          <div
            key={`${h.storagePath}-${i}`}
            className={`absolute inset-0 transition-opacity duration-700 ${
              i === heroIdx ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"
            }`}
          >
            <Image
              src={h.url}
              alt={h.alt || "Snímek firemního portálu RAJMONDATA pro řízení zakázek"}
              fill
              className="object-contain object-center"
              sizes="(max-width: 1024px) 100vw, 50vw"
              priority={i === 0}
              unoptimized
            />
          </div>
        ))}
      </div>
      {heroImages.length > 1 ? (
        <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
          {heroImages.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Snímek ${i + 1}`}
              className={`h-2.5 w-2.5 rounded-full transition ${
                i === heroIdx ? "bg-primary" : "bg-white/30 hover:bg-white/50"
              }`}
              onClick={() => setHeroIdx(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
