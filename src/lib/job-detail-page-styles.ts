/**
 * Jednotný vzhled stránky detailu zakázky — karty, typografie, sekce, pásy pro média/náklady.
 * Používejte spolu s `cn()` pro sloučení s dalšími třídami.
 */
export const JD = {
  page: "w-full min-w-0 space-y-6 sm:space-y-8",
  contentMax: "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8",
  grid: "grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8",
  mainCol: "lg:col-span-2 space-y-6",
  sideCol: "space-y-6",
  /** Karta: bílé pozadí, jemný border a stín (sladěno s Card z UI). */
  card: "border-gray-200 bg-white text-gray-950 shadow-sm",
  cardTitle:
    "text-lg font-semibold tracking-tight text-gray-950 flex items-center gap-2 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0 [&_svg]:text-primary",
  cardTitlePlain: "text-lg font-semibold tracking-tight text-gray-950",
  label: "text-xs font-semibold uppercase tracking-wide text-gray-800",
  body: "text-sm leading-relaxed text-gray-900",
  bodyMuted: "text-sm text-gray-800",
  innerBox:
    "rounded-lg border border-gray-200 bg-white p-3 text-gray-900 shadow-sm",
  innerBoxMuted: "rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900",
  financeHighlight:
    "space-y-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm",
  financeBreakdown:
    "space-y-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm",
  /** Pás pod hlavním obsahem (média, náklady) — stejná šířka jako contentMax, bílé pozadí jako karty */
  sectionBand: "w-full min-w-0 border-t border-gray-200 bg-white py-6 sm:py-8",
  sectionBandInner: "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8",
  headerTitle: "text-2xl font-semibold tracking-tight text-gray-950 sm:text-3xl",
  headerSubtitle: "text-sm text-gray-800",
  actionButton: "h-10 gap-2 px-4 text-sm",
} as const;
