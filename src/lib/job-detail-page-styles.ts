/**
 * Jednotný vzhled stránky detailu zakázky — karty, typografie, sekce, dashboard grid.
 */
export const JD = {
  page: "w-full min-w-0 space-y-5 sm:space-y-6",
  contentMax: "mx-auto w-full max-w-[1720px] px-4 sm:px-6 lg:px-8",
  /** Dashboard grid — 3 sloupce na velkém desktopu. */
  dashboardGrid:
    "grid min-w-0 w-full grid-cols-1 gap-4 md:gap-5 min-[900px]:grid-cols-2 min-[1400px]:grid-cols-3",
  /** Sekce přes celou šířku gridu. */
  spanFull: "min-w-0 col-span-1 min-[900px]:col-span-2 min-[1400px]:col-span-3",
  /** @deprecated — použijte dashboardGrid */
  stackCol: "min-w-0 w-full space-y-4 md:space-y-5",
  /** @deprecated */
  grid: "min-w-0 w-full space-y-4 md:space-y-5",
  /** @deprecated */
  mainCol: "min-w-0 w-full space-y-4 md:space-y-5",
  areaHeading:
    "text-[11px] font-semibold uppercase tracking-wider text-gray-500 pt-1 first:pt-0",
  card: "h-full border-gray-200 bg-white text-gray-950 shadow-sm rounded-xl",
  fullWidthCard:
    "w-full min-w-0 break-words border-gray-200 bg-white text-gray-950 shadow-sm rounded-xl",
  cardHeaderCompact: "pb-2 space-y-0",
  cardTitle:
    "text-base font-semibold tracking-tight text-gray-950 flex items-center gap-2 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-primary sm:text-[17px]",
  cardTitlePlain: "text-base font-semibold tracking-tight text-gray-950 sm:text-[17px]",
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
  financeSection:
    "rounded-xl border border-orange-200/80 bg-gradient-to-b from-orange-50/40 to-white p-4 sm:p-5",
  financeKpiGrid:
    "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 min-[1400px]:gap-4",
  financeKpiCard:
    "rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm shadow-sm min-w-0",
  sectionBand: "w-full min-w-0 border-t border-gray-200 bg-white py-5 sm:py-6",
  sectionBandInner: "mx-auto w-full max-w-[1720px] px-4 sm:px-6 lg:px-8",
  headerTitle: "text-xl font-semibold tracking-tight text-gray-950 sm:text-2xl",
  headerSubtitle: "text-xs sm:text-sm text-gray-700",
  headerBar: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
  actionButton: "h-9 gap-2 px-3 text-sm sm:h-10 sm:px-4",
} as const;
