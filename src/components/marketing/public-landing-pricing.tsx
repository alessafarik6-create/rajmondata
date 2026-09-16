"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { usePublicLandingConfig } from "@/lib/use-public-landing-config";
import { toYoutubeNocookieEmbedUrl } from "@/lib/youtube-nocookie-embed";
import type { PlatformSeoPromoVideo } from "@/lib/platform-seo-sanitize";

export function PublicLandingPricing() {
  const { data, err } = usePublicLandingConfig();

  const modules = useMemo(
    () => (Array.isArray(data?.modules) ? data!.modules! : []),
    [data?.modules]
  );

  const seo = data?.seo;
  const promo = data?.settings?.promoNote ?? "Ceny bez DPH. Moduly aktivuje superadmin po schválení.";
  const pricingSecTitle =
    (typeof seo?.pricingTitle === "string" && seo.pricingTitle.trim()) || "Tarify a moduly";
  const pricingSecSub =
    (typeof seo?.pricingSubtitle === "string" && seo.pricingSubtitle.trim()) || promo;
  const registerCta =
    (typeof seo?.registerButtonText === "string" && seo.registerButtonText.trim()) ||
    "Registrovat firmu";

  const priceEmployee = useMemo(() => {
    if (!data) return null;
    const att = modules.find((m) => m.code === "attendance_payroll");
    const ep = att?.employeePriceCzk;
    if (typeof ep === "number" && Number.isFinite(ep) && ep >= 0) return ep;
    const s = data.settings?.defaultEmployeePriceCzk;
    if (typeof s === "number" && Number.isFinite(s) && s >= 0) return s;
    return 49;
  }, [data, modules]);

  const promoVideo = (seo?.promoVideo as PlatformSeoPromoVideo | null | undefined) ?? null;

  return (
    <>
      {promoVideo && promoVideo.url.trim() ? (
        <section className="border-t border-white/10 bg-black/20 py-8 sm:py-12">
          <div className="mx-auto max-w-6xl px-3 sm:px-4 md:px-6">
            <h2 className="text-lg font-semibold text-slate-50 sm:text-xl">Video</h2>
            <div className="mt-4 max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-black shadow-lg">
              {promoVideo.type === "embed" ? (
                (() => {
                  const emb = toYoutubeNocookieEmbedUrl(promoVideo.url);
                  return emb ? (
                    <iframe
                      title="Ukázka platformy RAJMONDATA"
                      src={emb}
                      className="aspect-video w-full"
                      loading="lazy"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <p className="p-4 text-sm text-amber-200">Odkaz na video není podporovaný.</p>
                  );
                })()
              ) : (
                <video
                  className="aspect-video w-full bg-black"
                  controls
                  preload="metadata"
                  playsInline
                  src={promoVideo.url}
                >
                  Váš prohlížeč nepodporuje přehrávání videa.
                </video>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section id="cenik" className="scroll-mt-20 border-t border-white/10 py-8 sm:py-12 md:py-16">
        <div className="mx-auto max-w-6xl px-3 sm:px-4 md:px-6">
          <h2 className="text-xl font-bold text-slate-50 sm:text-2xl md:text-3xl">{pricingSecTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">{pricingSecSub}</p>
          {err ? <p className="mt-3 text-sm text-amber-300">{err}</p> : null}

          {!data && !err ? (
            <div className="mt-8 flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Načítání cen" />
            </div>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
              <Card className="border-primary/30 bg-slate-900/80 shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-slate-50 sm:text-lg">Docházka, práce a mzdy</CardTitle>
                  <CardDescription className="text-slate-300">
                    {priceEmployee == null ? (
                      <span className="inline-flex items-center gap-2 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> Načítám cenu…
                      </span>
                    ) : (
                      <>Od {priceEmployee} Kč / zaměstnanec / měsíc</>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-slate-300">
                  Docházka, výkazy a náklady podle počtu lidí ve firmě.
                </CardContent>
              </Card>

              {modules
                .filter((m) => m.code && m.code !== "attendance_payroll")
                .map((m) => (
                  <Card key={m.code} className="border-white/10 bg-slate-900/60 shadow-md">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base text-slate-50 sm:text-lg">{m.name ?? m.code}</CardTitle>
                      <CardDescription className="text-slate-300">
                        {m.billingType === "per_company"
                          ? `${typeof m.basePriceCzk === "number" && Number.isFinite(m.basePriceCzk) ? m.basePriceCzk : typeof m.priceMonthly === "number" ? m.priceMonthly : "—"} Kč / měsíc`
                          : "Dle domluvy"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0 text-sm text-slate-300 line-clamp-6">
                      {m.description ?? ""}
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}

          <div className="mt-10 flex justify-center sm:mt-12">
            <Button className="h-11 min-w-[12rem] px-6" asChild>
              <Link href="/register">
                {registerCta}
                {priceEmployee != null ? ` — od ${priceEmployee} Kč` : ""}
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
