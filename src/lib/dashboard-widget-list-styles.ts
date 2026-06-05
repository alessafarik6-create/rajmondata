/**
 * Scroll seznam v dashboard widgetech — zobrazí cca 6 položek, zbytek uvnitř boxu.
 * Mobil: menší z 55vh a ~34rem; desktop (lg+): pevně ~34rem (~6 řádků).
 */
export const DASHBOARD_WIDGET_LIST_SCROLL_CLASS =
  "min-h-0 max-h-[min(55vh,34rem)] overflow-y-auto [-webkit-overflow-scrolling:touch] lg:max-h-[34rem]";
