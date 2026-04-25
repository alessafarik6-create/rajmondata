"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import { Loader2, Sparkles } from "lucide-react";
import type { PlatformSeoHeroImage, PlatformSeoPromoVideo } from "@/lib/platform-seo-sanitize";
import { usePublicLandingConfig } from "@/lib/use-public-landing-config";
import { toYoutubeNocookieEmbedUrl } from "@/lib/youtube-nocookie-embed";

export function PublicLanding() {
  const { data, err } = usePublicLandingConfig();
  const [heroIdx, setHeroIdx] = useState(0);

  const modules = useMemo(
    () => (Array.isArray(data?.modules) ? data!.modules! : []),
    [data?.modules]
  );

  const seo = data?.seo;

  const headline =
    (typeof seo?.heroTitle === "string" && seo.heroTitle.trim()) ||
    data?.settings?.landingHeadline ||
    "Moderní provoz firmy na jedné platformě";
  const subline =
    (typeof seo?.heroSubtitle === "string" && seo.heroSubtitle.trim()) ||
    data?.settings?.landingSubline ||
    "Docházka, zakázky, fakturace a další — transparentní ceny, aktivace po schválení.";
  const lead =
    (typeof seo?.landingLead === "string" && seo.landingLead.trim()) ||
    "Spojte tým, zakázky a finance v jednom přehledném systému.";
  const promo =
    data?.settings?.promoNote ?? "Ceny bez DPH. Moduly aktivuje superadmin po schválení.";

  const registerCta =
    (typeof seo?.registerButtonText === "string" && seo.registerButtonText.trim()) ||
    "Registrovat firmu";
  const loginCta =
    (typeof seo?.loginButtonText === "string" && seo.loginButtonText.trim()) || "Přihlásit se";

  const benefitsTitle =
    (typeof seo?.benefitsTitle === "string" && seo.benefitsTitle.trim()) || "Proč Rajmondata";
  const benefitsBody = (typeof seo?.benefitsText === "string" && seo.benefitsText.trim()) || "";

  const pricingSecTitle =
    (typeof seo?.pricingTitle === "string" && seo.pricingTitle.trim()) || "Tarify a moduly";
  const pricingSecSub =
    (typeof seo?.pricingSubtitle === "string" && seo.pricingSubtitle.trim()) || promo;

  const priceEmployee = useMemo(() => {
    if (!data) return null;
    const att = modules.find((m) => m.code === "attendance_payroll");
    const ep = att?.employeePriceCzk;
    if (typeof ep === "number" && Number.isFinite(ep) && ep >= 0) return ep;
    const s = data.settings?.defaultEmployeePriceCzk;
    if (typeof s === "number" && Number.isFinite(s) && s >= 0) return s;
    return 49;
  }, [data, modules]);

  const heroImages = useMemo(() => {
    const raw = seo?.heroImages;
    if (!Array.isArray(raw)) return [];
    return [...raw]
      .filter((h): h is PlatformSeoHeroImage => !!h && typeof (h as PlatformSeoHeroImage).url === "string")
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [seo?.heroImages]);

  useEffect(() => {
    if (heroImages.length <= 1) return;
    const t = setInterval(() => {
      setHeroIdx((i) => (i + 1) % heroImages.length);
    }, 6500);
    return () => clearInterval(t);
  }, [heroImages.length]);

  const promoVideo = (seo?.promoVideo as PlatformSeoPromoVideo | null | undefined) ?? null;

  useEffect(() => {
    if (!data) return;
    const t = typeof seo?.metaTitle === "string" && seo.metaTitle.trim() ? seo.metaTitle : null;
    if (t) document.title = t;
    const md = document.querySelector('meta[name="description"]');
    if (md && typeof seo?.metaDescription === "string" && seo.metaDescription.trim()) {
      md.setAttribute("content", seo.metaDescription);
    }
    let mk = document.querySelector('meta[name="keywords"]');
    if (typeof seo?.keywords === "string" && seo.keywords.trim()) {
      if (!mk) {
        mk = document.createElement("meta");
        mk.setAttribute("name", "keywords");
        document.head.appendChild(mk);
      }
      mk.setAttribute("content", seo.keywords);
    }
  }, [data, seo?.metaDescription, seo?.metaTitle, seo?.keywords]);

  const benefitLines = useMemo(() => {
    if (!benefitsBody) return [] as string[];
    return benefitsBody
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [benefitsBody]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4 sm:py-5 md:px-6">
          <Logo context="page" compact className="max-w-[100vw] shrink" />
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end sm:gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-full border border-white/10 text-slate-100 sm:h-9 sm:w-auto sm:border-0"
              asChild
            >
              <Link href="/login">{loginCta}</Link>
            </Button>
            <Button size="sm" className="h-10 w-full sm:h-9 sm:w-auto" asChild>
              <Link href="/register">{registerCta}</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero: max výška na mobilu, žádné obří typy */}
      <section className="mx-auto min-h-0 max-w-6xl px-3 pb-8 pt-6 sm:px-4 sm:pb-12 sm:pt-8 md:px-6 md:pb-16 md:pt-10 lg:pt-12">
        <div className="grid min-h-0 items-center gap-6 lg:grid-cols-2 lg:gap-10 lg:pt-2">
          <div className="min-w-0 max-w-full">
            <p className="text-xs font-medium uppercase tracking-widest text-primary/90 sm:text-sm">
              {PLATFORM_NAME}
            </p>
            <h1 className="mt-2 max-w-full text-balance text-2xl font-bold leading-tight tracking-tight sm:mt-3 sm:text-4xl md:text-4xl lg:text-5xl">
              {headline}
            </h1>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-slate-300 sm:mt-4 sm:text-base md:text-lg">
              {subline}
            </p>
            <p className="mt-3 max-w-prose text-sm text-slate-400 sm:text-base">{lead}</p>

            <div className="mt-6 flex w-full min-w-0 flex-col gap-2 sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-3">
              <Button size="default" className="h-11 w-full min-w-0 sm:h-10 sm:w-auto sm:px-6" asChild>
                <Link href="/register">{registerCta}</Link>
              </Button>
              <Button
                size="default"
                variant="outline"
                className="h-11 w-full min-w-0 border-white/20 bg-white/5 text-slate-50 hover:bg-white/10 sm:h-10 sm:w-auto sm:px-6"
                asChild
              >
                <Link href="/login">{loginCta}</Link>
              </Button>
            </div>
          </div>

          <div className="min-w-0 lg:pl-2">
            {heroImages.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 sm:text-sm">Ilustrace / ukázka</p>
                <div
                  className="relative w-full max-h-[42dvh] overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-xl sm:max-h-[min(52dvh,520px)] lg:aspect-[4/3] lg:max-h-[min(78vh,640px)]"
                >
                  {heroImages.map((h, i) => (
                    <div
                      key={`${h.storagePath}-${i}`}
                      className={`absolute inset-0 transition-opacity duration-700 ${
                        i === heroIdx ? "z-10 opacity-100" : "z-0 opacity-0 pointer-events-none"
                      }`}
                    >
                      <Image
                        src={h.url}
                        alt={h.alt || "Ukázka platformy"}
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
                        className={`h-2 w-2 rounded-full transition sm:h-2.5 sm:w-2.5 ${
                          i === heroIdx ? "bg-primary" : "bg-white/30 hover:bg-white/50"
                        }`}
                        onClick={() => setHeroIdx(i)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-white/15 bg-slate-900/40 p-6 text-center text-sm text-slate-500 sm:min-h-[240px]">
                Obrázky můžete přidat v superadmin / SEO
              </div>
            )}
          </div>
        </div>
      </section>

      {benefitLines.length > 0 ? (
        <section className="border-t border-white/10 bg-slate-900/40 py-8 sm:py-12">
          <div className="mx-auto max-w-6xl px-3 sm:px-4 md:px-6">
            <div className="mb-5 flex items-center gap-2 sm:mb-6">
              <Sparkles className="h-5 w-5 shrink-0 text-primary" />
              <h2 className="text-lg font-semibold sm:text-xl md:text-2xl">{benefitsTitle}</h2>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {benefitLines.map((line, i) => (
                <li
                  key={i}
                  className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm leading-relaxed text-slate-200 shadow-sm sm:px-5 sm:py-4 sm:text-base"
                >
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {promoVideo && promoVideo.url.trim() ? (
        <section className="border-t border-white/10 bg-black/20 py-8 sm:py-12">
          <div className="mx-auto max-w-6xl px-3 sm:px-4 md:px-6">
            <h2 className="text-base font-semibold sm:text-lg">Video</h2>
            <div className="mt-4 max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-black shadow-lg">
              {promoVideo.type === "embed" ? (
                (() => {
                  const emb = toYoutubeNocookieEmbedUrl(promoVideo.url);
                  return emb ? (
                    <iframe
                      title="Ukázka platformy"
                      src={emb}
                      className="aspect-video w-full"
                      loading="lazy"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <p className="p-4 text-sm text-amber-200">Odkaz na video není podporovaný (použijte YouTube).</p>
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

      <section className="border-t border-white/10 py-8 sm:py-12 md:py-16">
        <div className="mx-auto max-w-6xl px-3 sm:px-4 md:px-6">
          <h2 className="text-xl font-bold sm:text-2xl md:text-3xl">{pricingSecTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">{pricingSecSub}</p>
          {err ? <p className="mt-3 text-sm text-amber-300">{err}</p> : null}

          {!data && !err ? (
            <div className="mt-8 flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
              <Card className="border-primary/30 bg-slate-900/80 shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base sm:text-lg">Docházka, práce a mzdy</CardTitle>
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
                      <CardTitle className="text-base sm:text-lg">{m.name ?? m.code}</CardTitle>
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

      <footer className="border-t border-white/10 py-8 text-center text-xs text-slate-500 sm:py-10 sm:text-sm">
        © {new Date().getFullYear()} {PLATFORM_NAME}
      </footer>
    </div>
  );
}
