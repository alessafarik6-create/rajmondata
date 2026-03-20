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
