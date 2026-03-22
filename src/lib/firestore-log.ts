import type { FirestoreError } from "firebase/firestore";

export type FirestoreLogOperation =
  | "get"
  | "list"
  | "listen-doc"
  | "listen-query"
  | "getDocs"
  | "create";

/**
 * Jednotné logování chyb Firestore (pravidla, síť, index, …).
 */
export function logFirestoreFailure(
  path: string,
  operation: FirestoreLogOperation,
  err: unknown
): void {
  const e = err as Partial<FirestoreError> & { message?: string };
  console.error("[Firestore]", {
    path,
    operation,
    "error.code": e?.code ?? "(unknown)",
    "error.message": e?.message ?? String(err),
  });
}
