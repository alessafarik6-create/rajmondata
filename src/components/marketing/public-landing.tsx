"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import { Loader2 } from "lucide-react";
import type { PlatformSeoHeroImage, PlatformSeoPromoVideo } from "@/lib/platform-seo-sanitize";

type LandingPayload = {
  settings?: {
    defaultEmployeePriceCzk?: number;
    landingHeadline?: string;
    landingSubline?: string;
    promoNote?: string;
  };
  seo?: {
    metaTitle?: string;
    metaDescription?: string;
    landingLead?: string;
    heroImages?: PlatformSeoHeroImage[];
    promoVideo?: PlatformSeoPromoVideo | null;
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
};

function youtubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function PublicLanding() {
  const [data, setData] = useState<LandingPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [heroIdx, setHeroIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/landing-config", { cache: "no-store" });
        const j = await res.json().catch(() => ({}));
        if (!cancelled) {
          setData(j);
          if (j?.seo?.metaTitle) {
            document.title = j.seo.metaTitle;
          }
          const md = document.querySelector('meta[name="description"]');
          if (md && j?.seo?.metaDescription) {
            md.setAttribute("content", j.seo.metaDescription);
          }
        }
      } catch {
        if (!cancelled) setErr("Nepodařilo se načíst obsah stránky.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const modules = useMemo(
    () => (Array.isArray(data?.modules) ? data!.modules! : []),
    [data?.modules]
  );

  const headline =
    data?.settings?.landingHeadline ?? "Moderní provoz firmy na jedné platformě";
  const subline =
    data?.settings?.landingSubline ??
    "Docházka, zakázky, fakturace a další — transparentní ceny, aktivace po schválení.";
  const lead =
    data?.seo?.landingLead ?? "Spojte tým, zakázky a finance v jednom přehledném systému.";
  const promo =
    data?.settings?.promoNote ?? "Ceny bez DPH. Moduly aktivuje superadmin po schválení.";

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
    const raw = data?.seo?.heroImages;
    if (!Array.isArray(raw)) return [];
    return [...raw]
      .filter((h) => h && typeof h.url === "string" && h.url.trim())
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [data?.seo?.heroImages]);

  useEffect(() => {
    if (heroImages.length <= 1) return;
    const t = setInterval(() => {
      setHeroIdx((i) => (i + 1) % heroImages.length);
    }, 6000);
    return () => clearInterval(t);
  }, [heroImages.length]);

  const promoVideo = data?.seo?.promoVideo ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-8">
          <Logo context="page" />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" className="text-slate-200" asChild>
              <Link href="/login">Přihlášení</Link>
            </Button>
            <Button asChild>
              <Link href="/register">Registrace firmy</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <p className="text-sm font-medium uppercase tracking-widest text-primary/90">{PLATFORM_NAME}</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">{headline}</h1>
        <p className="mt-6 max-w-2xl text-lg text-slate-300">{subline}</p>
        <p className="mt-4 max-w-2xl text-slate-300">{lead}</p>

        {heroImages.length > 0 ? (
          <div className="mt-12 space-y-3">
            <p className="text-sm font-medium text-slate-400">Ukázka z praxe</p>
            <div className="relative aspect-[21/9] max-h-[420px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-xl">
              {heroImages.map((h, i) => (
                <div
                  key={`${h.storagePath}-${i}`}
                  className={`absolute inset-0 transition-opacity duration-700 ${
                    i === heroIdx ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
                  }`}
                >
                  <Image
                    src={h.url}
                    alt={h.alt || "Ukázka platformy"}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 1152px"
                    priority={i === 0}
                    unoptimized
                  />
                </div>
              ))}
            </div>
            {heroImages.length > 1 ? (
              <div className="flex flex-wrap gap-2">
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
        ) : null}

        <div className="mt-10 flex flex-wrap gap-3">
          <Button size="lg" asChild>
            <Link href="/register">Vytvořit účet firmy</Link>
          </Button>
          <Button size="lg" variant="outline" className="border-white/20 bg-white/5 text-foreground" asChild>
            <Link href="/login">Už mám účet</Link>
          </Button>
        </div>
      </section>

      {promoVideo && promoVideo.url.trim() ? (
        <section className="border-t border-white/10 bg-black/25 py-12 sm:py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-xl font-semibold text-slate-100">Video</h2>
            <div className="mt-6 max-w-4xl overflow-hidden rounded-xl border border-white/10 bg-black shadow-lg">
              {promoVideo.type === "embed" ? (
                (() => {
                  const emb = youtubeEmbedUrl(promoVideo.url);
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
                    <p className="p-4 text-sm text-amber-200">
                      Odkaz na video není podporovaný formát (použijte YouTube).
                    </p>
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

      <section className="border-t border-white/10 bg-black/20 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-2xl font-bold sm:text-3xl">Tarify a moduly</h2>
          <p className="mt-2 max-w-2xl text-slate-300">{promo}</p>
          {err ? <p className="mt-4 text-sm text-amber-300">{err}</p> : null}

          {!data && !err ? (
            <div className="mt-10 flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="border-primary/30 bg-slate-900/80">
                <CardHeader>
                  <CardTitle className="text-lg">Docházka, práce a mzdy</CardTitle>
                  <CardDescription className="text-slate-300">
                    {priceEmployee == null ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Načítám cenu…
                      </span>
                    ) : (
                      <>Od {priceEmployee} Kč / zaměstnanec / měsíc</>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-slate-300">
                  Docházka, výkazy a výpočet nákladů podle počtu lidí ve firmě.
                </CardContent>
              </Card>

              {modules
                .filter((m) => m.code && m.code !== "attendance_payroll")
                .map((m) => (
                  <Card key={m.code} className="border-white/10 bg-slate-900/60">
                    <CardHeader>
                      <CardTitle className="text-lg">{m.name ?? m.code}</CardTitle>
                      <CardDescription className="text-slate-300">
                        {m.billingType === "per_company"
                          ? `${typeof m.basePriceCzk === "number" && Number.isFinite(m.basePriceCzk) ? m.basePriceCzk : typeof m.priceMonthly === "number" ? m.priceMonthly : "—"} Kč / měsíc`
                          : "Dle domluvy"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-slate-300">
                      {m.description ?? ""}
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}

          <div className="mt-12 flex justify-center">
            <Button size="lg" asChild>
              <Link href="/register">
                Začít
                {priceEmployee != null ? ` — od ${priceEmployee} Kč` : ""}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 py-10 text-center text-sm text-slate-400">
        © {new Date().getFullYear()} {PLATFORM_NAME}
      </footer>
    </div>
  );
}
