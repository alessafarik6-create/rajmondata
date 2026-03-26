/**
 * Rozpoznání chyb Firestore souvisejících s chybějícím / rozpracovaným composite indexem.
 * (typicky `failed-precondition` + text o indexu v message)
 */

export function isFirestoreIndexError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code !== "failed-precondition") return false;
  const m = String(e.message ?? "").toLowerCase();
  if (m.includes("transaction") && m.includes("aborted")) return false;
  return (
    m.includes("index") ||
    m.includes("requires an index") ||
    m.includes("query requires") ||
    m.includes("create it") ||
    m.includes("composite")
  );
}

export function logFirestoreIndexError(
  context: string,
  path: string,
  error: unknown
): void {
  console.warn(
    `[Firestore] ${context} — data se připravují (index):`,
    path,
    error
  );
}
