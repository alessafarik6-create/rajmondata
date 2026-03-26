"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import { Loader2 } from "lucide-react";

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
  };
  modules?: Array<{
    code?: string;
    name?: string;
    description?: string;
    basePriceCzk?: number;
    employeePriceCzk?: number;
    billingType?: string;
  }>;
};

export function PublicLanding() {
  const [data, setData] = useState<LandingPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  const headline = data?.settings?.landingHeadline ?? "Moderní provoz firmy na jedné platformě";
  const subline =
    data?.settings?.landingSubline ??
    "Docházka, zakázky, fakturace a další — transparentní ceny, aktivace po schválení.";
  const lead = data?.seo?.landingLead ?? "Spojte tým, zakázky a finance v jednom přehledném systému.";
  const promo = data?.settings?.promoNote ?? "Ceny bez DPH. Moduly aktivuje superadmin po schválení.";
  const priceEmployee = data?.settings?.defaultEmployeePriceCzk ?? 49;

  const modules = Array.isArray(data?.modules) ? data.modules : [];

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
        <div className="mt-10 flex flex-wrap gap-3">
          <Button size="lg" asChild>
            <Link href="/register">Vytvořit účet firmy</Link>
          </Button>
          <Button size="lg" variant="outline" className="border-white/20 bg-white/5 text-foreground" asChild>
            <Link href="/login">Už mám účet</Link>
          </Button>
        </div>
      </section>

      <section className="border-t border-white/10 bg-black/20 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-2xl font-bold sm:text-3xl">Tarify a moduly</h2>
          <p className="mt-2 max-w-2xl text-slate-300">{promo}</p>
          {err ? <p className="mt-4 text-sm text-amber-800">{err}</p> : null}

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
                    Od {priceEmployee} Kč / zaměstnanec / měsíc
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
                          ? `${m.basePriceCzk ?? "—"} Kč / měsíc`
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
              <Link href="/register">Začít — od {priceEmployee} Kč</Link>
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
