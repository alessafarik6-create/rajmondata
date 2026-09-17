import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import {
  HOME_H1,
  HOME_HERO_AI,
  HOME_HERO_LEAD,
} from "@/lib/marketing/homepage-seo";
import { PublicLandingSeoSections } from "@/components/marketing/public-landing-seo-sections";
import { PublicLandingHeroMedia } from "@/components/marketing/public-landing-hero-media";
import { PublicLandingPricing } from "@/components/marketing/public-landing-pricing";
import { PublicLandingJsonLd } from "@/components/marketing/public-landing-json-ld";
import { PublicMarketingFooter } from "@/components/marketing/public-marketing-footer";
import { PublicMarketingHeader } from "@/components/marketing/public-marketing-header";

export function PublicLandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <PublicLandingJsonLd />

      <PublicMarketingHeader />

      <section className="mx-auto min-h-0 max-w-6xl px-3 pb-8 pt-6 sm:px-4 sm:pb-12 sm:pt-8 md:px-6 md:pb-16 md:pt-10 lg:pt-12">
        <div className="grid min-h-0 items-center gap-6 lg:grid-cols-2 lg:gap-10 lg:pt-2">
          <div className="min-w-0 max-w-full">
            <p className="text-xs font-medium uppercase tracking-widest text-primary/90 sm:text-sm">
              {PLATFORM_NAME} — firemní portál
            </p>
            <h1 className="mt-2 max-w-full text-balance text-2xl font-bold leading-tight tracking-tight sm:mt-3 sm:text-4xl lg:text-5xl">
              {HOME_H1}
            </h1>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-slate-300 sm:mt-4 sm:text-base md:text-lg">
              {HOME_HERO_LEAD}
            </p>
            <p className="mt-3 max-w-prose text-sm text-slate-400 sm:text-base">{HOME_HERO_AI}</p>
            <p className="mt-3 max-w-prose text-sm text-slate-400 sm:text-base">
              Pro montážní a řemeslné firmy, které chtějí software pro řízení zakázek, správu
              poptávek a přehled nad celým provozem — od první poptávky po fakturu.
            </p>

            <div className="mt-6 flex w-full min-w-0 flex-col gap-2 sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-3">
              <Button size="default" className="h-11 w-full min-w-0 sm:h-10 sm:w-auto sm:px-6" asChild>
                <Link href="/register">Vyzkoušet RAJMONDATA</Link>
              </Button>
              <Button
                size="default"
                variant="outline"
                className="h-11 w-full min-w-0 border-white/20 bg-white/5 text-slate-50 hover:bg-white/10 sm:h-10 sm:w-auto sm:px-6"
                asChild
              >
                <Link href="/funkce">Podívat se na funkce</Link>
              </Button>
              <Button
                size="default"
                variant="ghost"
                className="h-11 w-full text-slate-200 sm:h-10 sm:w-auto"
                asChild
              >
                <Link href="/login">Přihlásit se</Link>
              </Button>
            </div>
          </div>

          <div className="min-w-0 lg:pl-2">
            <PublicLandingHeroMedia />
          </div>
        </div>
      </section>

      <PublicLandingSeoSections />
      <PublicLandingPricing />

      <PublicMarketingFooter />
    </div>
  );
}
