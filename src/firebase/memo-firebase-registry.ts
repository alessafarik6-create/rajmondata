/**
 * Firestore Query / DocumentReference jsou často neextensible — nelze na ně bezpečně
 * přidávat vlastnosti (např. __memo). Používáme WeakSet pro označení hodnot z useMemoFirebase.
 */
const memoFirebaseTargets = new WeakSet<object>();

export function registerMemoFirebaseTarget(value: unknown): void {
  if (value !== null && typeof value === "object") {
    memoFirebaseTargets.add(value as object);
  }
}

export function isMemoFirebaseTarget(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return memoFirebaseTargets.has(value as object);
}
