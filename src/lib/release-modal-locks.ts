/**
 * Uvolní styly, které po Radix Dialog/Sheet někdy zůstanou na <body> / <html>
 * (blokuje klikání na celém portálu).
 */
export function releaseDocumentModalLocks(): void {
  if (typeof document === "undefined") return;
  document.body.style.removeProperty("pointer-events");
  document.body.style.removeProperty("overflow");
  document.documentElement.style.removeProperty("overflow");
}

/**
 * Radix Dialog / Dropdown někdy dokončí úklid scroll-locku a pointer-events až po animaci.
 * Okamžité volání release může být přepsáno nebo proběhne dřív než unmount — pak zůstane
 * `pointer-events: none` na body a portál „zamrzne“.
 */
export function releaseDocumentModalLocksAfterTransition(ms: number = 320): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  window.setTimeout(() => {
    releaseDocumentModalLocks();
    window.requestAnimationFrame(() => releaseDocumentModalLocks());
  }, ms);
}
