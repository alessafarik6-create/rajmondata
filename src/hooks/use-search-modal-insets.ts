"use client";

import { useCallback, useEffect, useState } from "react";

const DEFAULT_TOP_PX = 156;
const MIN_TOP_PX = 120;
const BOTTOM_MARGIN_PX = 20;

export type SearchModalInsets = {
  topPx: number;
  maxHeightCss: string;
};

/**
 * Dynamický offset modalu pod sticky header + PWA instalační lištu.
 */
export function useSearchModalInsets(open: boolean): SearchModalInsets {
  const [topPx, setTopPx] = useState(DEFAULT_TOP_PX);

  const measure = useCallback(() => {
    if (typeof document === "undefined") return;
    const header = document.querySelector("header.print\\:hidden");
    const pwaBanner = document.querySelector('[data-pwa-install-banner="true"]');
    const headerH = header?.getBoundingClientRect().height ?? 64;
    const pwaH = pwaBanner?.getBoundingClientRect().height ?? 0;
    const safeTop =
      typeof window !== "undefined"
        ? Number.parseInt(
            getComputedStyle(document.documentElement).getPropertyValue("env(safe-area-inset-top)") ||
              "0",
            10
          ) || 0
        : 0;
    const next = Math.max(MIN_TOP_PX, Math.round(headerH + pwaH + safeTop + 12));
    setTopPx(next);
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();
    const t = window.setTimeout(measure, 80);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    const obs =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measure())
        : null;
    const header = document.querySelector("header.print\\:hidden");
    const pwaBanner = document.querySelector('[data-pwa-install-banner="true"]');
    if (obs && header) obs.observe(header);
    if (obs && pwaBanner) obs.observe(pwaBanner);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      obs?.disconnect();
    };
  }, [open, measure]);

  const maxHeightCss = `calc(100dvh - ${topPx + BOTTOM_MARGIN_PX}px)`;

  return { topPx, maxHeightCss };
}
