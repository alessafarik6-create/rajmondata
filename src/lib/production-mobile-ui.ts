import { cn } from "@/lib/utils";

/** Kořen stránek modulu Výroba — tmavý režim pod `lg` (shodně s mobilním dashboardem). */
export const VYROBA_MOBILE_PAGE_ROOT = cn(
  "max-lg:bg-slate-950 max-lg:text-slate-100",
  "max-lg:min-h-[100dvh] max-lg:overflow-x-hidden",
  "max-lg:pb-[calc(96px+env(safe-area-inset-bottom))]",
  "max-lg:px-2 max-lg:pt-2 sm:max-lg:px-3"
);

/** Základní karta / panel ve výrobě na mobilu/tabletu. */
export const VYROBA_MOBILE_SURFACE = cn(
  "max-lg:rounded-xl max-lg:border max-lg:border-slate-700/90",
  "max-lg:bg-slate-900/95 max-lg:text-slate-100 max-lg:shadow-lg"
);

/** Primární akce (oranžová). */
export const VYROBA_MOBILE_PRIMARY = cn(
  "max-lg:min-h-11 max-lg:px-4 max-lg:text-base",
  "max-lg:bg-orange-600 max-lg:text-white hover:max-lg:bg-orange-500",
  "max-lg:border-orange-500/40"
);

/** Sekundární / outline tlačítka na tmavém pozadí. */
export const VYROBA_MOBILE_SECONDARY = cn(
  "max-lg:min-h-11 max-lg:px-4 max-lg:text-base",
  "max-lg:border-slate-500 max-lg:bg-slate-800/90 max-lg:text-slate-100",
  "hover:max-lg:bg-slate-700"
);

/** Nadpisy sekcí na mobilu. */
export const VYROBA_MOBILE_SECTION_TITLE = "max-lg:text-orange-100 max-lg:border-slate-600";

/** Úprava světlých „karet“ uvnitř tmavého kontextu (dědičnost přes potomky). */
export const VYROBA_MOBILE_NESTED_LIGHT_FIX = cn(
  "max-lg:[&_.text-slate-900]:!text-slate-50",
  "max-lg:[&_.text-slate-800]:!text-slate-200",
  "max-lg:[&_.text-slate-700]:!text-slate-300",
  "max-lg:[&_.text-slate-600]:!text-slate-400",
  "max-lg:[&_.text-slate-500]:!text-slate-400",
  "max-lg:[&_.border-slate-200]:!border-slate-600",
  "max-lg:[&_.border-slate-100]:!border-slate-700",
  "max-lg:[&_.bg-white]:!bg-slate-800/95",
  "max-lg:[&_.bg-slate-50]:!bg-slate-800/70"
);
