'use client';

import { useState, useEffect, useId } from 'react';
import {
  Query,
  onSnapshot,
  DocumentData,
  FirestoreError,
  QuerySnapshot,
  CollectionReference,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { logFirestoreFailure } from '@/lib/firestore-log';
import { isMemoFirebaseTarget } from '@/firebase/memo-firebase-registry';
import {
  isFirestoreIndexError,
  logFirestoreIndexError,
} from '@/firebase/firestore/firestore-query-errors';
import { useFirestoreIndexPendingRegistry } from '@/firebase/firestore/firestore-index-pending-registry';

/** Utility type to add an 'id' field to a given type T. */
export type WithId<T> = T & { id: string };

/**
 * Interface for the return value of the useCollection hook.
 * @template T Type of the document data.
 */
export interface UseCollectionResult<T> {
  data: WithId<T>[] | null; // Document data with ID, or null.
  isLoading: boolean;       // True if loading.
  error: FirestoreError | Error | null; // Error object, or null.
  /** Chybí / se vytváří Firestore index — fallback UI „data se připravují“. */
  isIndexPending: boolean;
}

/** Volitelné chování u `useCollection` (např. stránky, kde nesmí permission denied shodit celou app přes FirebaseErrorListener). */
export type UseCollectionOptions = {
  /**
   * Když true, při permission denied se neemituje `permission-error` do globálního error emitteru
   * (FirebaseErrorListener by jinak při přerenderu vyhodil výjimku a spadla celá aplikace).
   */
  suppressGlobalPermissionError?: boolean;
};

/* Internal implementation of Query:
  https://github.com/firebase/firebase-js-sdk/blob/c5f08a9bc5da0d2b0207802c972d53724ccef055/packages/firestore/src/lite-api/reference.ts#L143
*/
export interface InternalQuery extends Query<DocumentData> {
  _query?: {
    path?: {
      canonicalString(): string;
      toString(): string;
    };
  };
}

/** Safe path string for logging / permission errors (never throws). */
function getFirestoreListenerDebugPath(
  target: CollectionReference<DocumentData> | Query<DocumentData>,
): string {
  try {
    const asCol = target as CollectionReference<DocumentData>;
    if (typeof asCol.path === "string" && asCol.path.length > 0) {
      return asCol.path;
    }
    const internal = target as unknown as InternalQuery;
    return internal._query?.path?.canonicalString?.() ?? "(query)";
  } catch {
    return "(unknown-path)";
  }
}

/**
 * React hook to subscribe to a Firestore collection or query in real-time.
 * Handles nullable references/queries.
 * 
 *
 * IMPORTANT! YOU MUST MEMOIZE the inputted memoizedTargetRefOrQuery or BAD THINGS WILL HAPPEN
 * use useMemo to memoize it per React guidence.  Also make sure that it's dependencies are stable
 * references
 *  
 * @template T Optional type for document data. Defaults to any.
 * @param {CollectionReference<DocumentData> | Query<DocumentData> | null | undefined} targetRefOrQuery -
 * The Firestore CollectionReference or Query. Waits if null/undefined.
 * @returns {UseCollectionResult<T>} Object with data, isLoading, error.
 */
export function useCollection<T = any>(
    memoizedTargetRefOrQuery: ((CollectionReference<DocumentData> | Query<DocumentData>) & {__memo?: boolean})  | null | undefined,
    options?: UseCollectionOptions,
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  type StateDataType = ResultItemType[] | null;

  const [data, setData] = useState<StateDataType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => !!memoizedTargetRefOrQuery);
  const [error, setError] = useState<FirestoreError | Error | null>(null);
  const [isIndexPending, setIsIndexPending] = useState(false);
  const instanceId = useId();
  const indexRegistry = useFirestoreIndexPendingRegistry();

  useEffect(() => {
    if (!memoizedTargetRefOrQuery) {
      setData(null);
      setIsLoading(false);
      setError(null);
      setIsIndexPending(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setIsIndexPending(false);

    const path = getFirestoreListenerDebugPath(memoizedTargetRefOrQuery);
    const registryKey = `useCollection:${path}:${instanceId}`;

    const unsubscribe = onSnapshot(
      memoizedTargetRefOrQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        const results: ResultItemType[] = [];
        for (const doc of snapshot.docs) {
          results.push({ ...(doc.data() as T), id: doc.id });
        }
        setData(results);
        setError(null);
        setIsIndexPending(false);
        setIsLoading(false);
        if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
          console.log("User updated from snapshot", path, results.length, "docs");
        }
      },
      (err: FirestoreError) => {
        logFirestoreFailure(path, "listen-query", err);

        if (isFirestoreIndexError(err)) {
          logFirestoreIndexError("useCollection", path, err);
          setError(err);
          /** Prázdné pole místo null — stránky používají výchozí `= []` jen pro `undefined`; při indexu jinak padají výpočty a „0 Kč“ vypadá jako skutečná nula. */
          setData([]);
          setIsLoading(false);
          setIsIndexPending(true);
          return;
        }

        setIsIndexPending(false);
        const contextualError = new FirestorePermissionError({
          operation: "list",
          path,
        });

        setError(contextualError);
        setData([]);
        setIsLoading(false);

        if (!options?.suppressGlobalPermissionError) {
          errorEmitter.emit("permission-error", contextualError);
        }
      }
    );

    return () => {
      indexRegistry?.unregister(registryKey);
      unsubscribe();
    };
  }, [
    memoizedTargetRefOrQuery,
    options?.suppressGlobalPermissionError,
    instanceId,
    indexRegistry,
  ]);

  useEffect(() => {
    if (!memoizedTargetRefOrQuery || !indexRegistry) return;
    const path = getFirestoreListenerDebugPath(memoizedTargetRefOrQuery);
    const registryKey = `useCollection:${path}:${instanceId}`;
    if (isIndexPending) {
      indexRegistry.register(registryKey);
    } else {
      indexRegistry.unregister(registryKey);
    }
    return () => {
      indexRegistry.unregister(registryKey);
    };
  }, [memoizedTargetRefOrQuery, instanceId, isIndexPending, indexRegistry]);
  if (
    memoizedTargetRefOrQuery &&
    !isMemoFirebaseTarget(memoizedTargetRefOrQuery)
  ) {
    throw new Error(
      `${String(memoizedTargetRefOrQuery)} was not properly memoized using useMemoFirebase`,
    );
  }
  return { data, isLoading, error, isIndexPending };
}