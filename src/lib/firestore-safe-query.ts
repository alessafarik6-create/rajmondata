/**
 * Bezpečné jednorázové čtení kolekce/dotazu – při chybě indexu nepropadne stránka.
 */

import {
  getDocs,
  type CollectionReference,
  type FirestoreError,
  type Query,
  type QuerySnapshot,
} from "firebase/firestore";
import {
  isFirestoreIndexError,
  logFirestoreIndexError,
} from "@/firebase/firestore/firestore-query-errors";

export type GetDocsSafeResult<T> = {
  snapshot: QuerySnapshot<T> | null;
  /** true = chybí nebo se ještě buduje composite index */
  isIndexPending: boolean;
  error: FirestoreError | null;
};

export async function getDocsSafe<T>(
  q: Query<T> | CollectionReference<T>,
  context: string,
  debugPath?: string
): Promise<GetDocsSafeResult<T>> {
  const path =
    debugPath ??
    (typeof (q as { path?: string }).path === "string"
      ? (q as { path: string }).path
      : "(query)");
  try {
    const snapshot = await getDocs(q);
    return { snapshot, isIndexPending: false, error: null };
  } catch (e) {
    if (isFirestoreIndexError(e)) {
      logFirestoreIndexError("getDocsSafe", path, e);
      return {
        snapshot: null,
        isIndexPending: true,
        error: e as FirestoreError,
      };
    }
    console.error(`[Firestore] getDocsSafe (${context})`, path, e);
    throw e;
  }
}
