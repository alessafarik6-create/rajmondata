/**
 * When Firebase services are unavailable, `useFirebase()` returns `firestore: {} as any`
 * (see provider). That value is truthy and must not be passed to `collection()` / `doc()`.
 */
export function isBindableFirestoreInstance(
  areServicesAvailable: boolean,
  firestore: unknown
): boolean {
  if (typeof window === "undefined") return false;
  if (!areServicesAvailable) return false;
  if (firestore == null || typeof firestore !== "object") return false;
  const proto = Object.getPrototypeOf(firestore);
  if (proto === Object.prototype && Object.keys(firestore as Record<string, unknown>).length === 0) {
    return false;
  }
  return true;
}
