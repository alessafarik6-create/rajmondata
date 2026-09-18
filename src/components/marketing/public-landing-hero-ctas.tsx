"use client";

import Link from "next/link";
import { trackPublicEvent } from "@/components/marketing/public-analytics-beacon";
import { Button } from "@/components/ui/button";

export function PublicLandingHeroCtas() {
  return (
    <div className="mt-6 flex w-full min-w-0 flex-col gap-2 sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-3">
      <Button size="default" className="h-11 w-full min-w-0 sm:h-10 sm:w-auto sm:px-6" asChild>
        <Link href="/register" onClick={() => trackPublicEvent("funnel_cta_try")}>
          Vyzkoušet RAJMONDATA
        </Link>
      </Button>
      <Button
        size="default"
        variant="outline"
        className="h-11 w-full min-w-0 border-white/20 bg-white/5 text-slate-50 hover:bg-white/10 sm:h-10 sm:w-auto sm:px-6"
        asChild
      >
        <Link href="/funkce" onClick={() => trackPublicEvent("click_features")}>
          Podívat se na funkce
        </Link>
      </Button>
      <Button size="default" variant="ghost" className="h-11 w-full text-slate-200 sm:h-10 sm:w-auto" asChild>
        <Link href="/login">Přihlásit se</Link>
      </Button>
    </div>
  );
}
