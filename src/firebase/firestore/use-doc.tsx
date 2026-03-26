'use client';

import { useState, useEffect, useId } from 'react';
import {
  DocumentReference,
  onSnapshot,
  DocumentData,
  FirestoreError,
  DocumentSnapshot,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { logFirestoreFailure } from '@/lib/firestore-log';
import {
  isFirestoreIndexError,
  logFirestoreIndexError,
} from '@/firebase/firestore/firestore-query-errors';
import { useFirestoreIndexPendingRegistry } from '@/firebase/firestore/firestore-index-pending-registry';

/** Utility type to add an 'id' field to a given type T. */
type WithId<T> = T & { id: string };

/**
 * Interface for the return value of the useDoc hook.
 * @template T Type of the document data.
 */
export interface UseDocResult<T> {
  data: WithId<T> | null; // Document data with ID, or null.
  isLoading: boolean;       // True if loading.
  error: FirestoreError | Error | null; // Error object, or null.
  isIndexPending: boolean;
}

/**
 * React hook to subscribe to a single Firestore document in real-time.
 * Handles nullable references.
 * 
 * IMPORTANT! YOU MUST MEMOIZE the inputted memoizedTargetRefOrQuery or BAD THINGS WILL HAPPEN
 * use useMemo to memoize it per React guidence.  Also make sure that it's dependencies are stable
 * references
 *
 *
 * @template T Optional type for document data. Defaults to any.
 * @param {DocumentReference<DocumentData> | null | undefined} docRef -
 * The Firestore DocumentReference. Waits if null/undefined.
 * @returns {UseDocResult<T>} Object with data, isLoading, error.
 */
export function useDoc<T = any>(
  memoizedDocRef: DocumentReference<DocumentData> | null | undefined,
): UseDocResult<T> {
  type StateDataType = WithId<T> | null;

  const [data, setData] = useState<StateDataType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => !!memoizedDocRef);
  const [error, setError] = useState<FirestoreError | Error | null>(null);
  const [isIndexPending, setIsIndexPending] = useState(false);
  const instanceId = useId();
  const indexRegistry = useFirestoreIndexPendingRegistry();

  useEffect(() => {
    if (!memoizedDocRef) {
      setData(null);
      setIsLoading(false);
      setError(null);
      setIsIndexPending(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setIsIndexPending(false);

    const docPath =
      typeof memoizedDocRef.path === "string" && memoizedDocRef.path.length > 0
        ? memoizedDocRef.path
        : "(unknown-doc-path)";
    const registryKey = `useDoc:${docPath}:${instanceId}`;

    const unsubscribe = onSnapshot(
      memoizedDocRef,
      (snapshot: DocumentSnapshot<DocumentData>) => {
        if (snapshot.exists()) {
          const docData = { ...(snapshot.data() as T), id: snapshot.id };
          setData(docData);
          if (typeof window !== "undefined") {
            console.debug("[useDoc]", memoizedDocRef.path, docData);
          }
        } else {
          setData(null);
          if (typeof window !== "undefined") {
            console.debug("[useDoc]", memoizedDocRef.path, "document does not exist");
          }
        }
        setError(null);
        setIsIndexPending(false);
        setIsLoading(false);
      },
      (err: FirestoreError) => {
        logFirestoreFailure(docPath, "listen-doc", err);

        if (isFirestoreIndexError(err)) {
          logFirestoreIndexError("useDoc", docPath, err);
          setError(err);
          setData(null);
          setIsLoading(false);
          setIsIndexPending(true);
          return;
        }

        setIsIndexPending(false);
        const contextualError = new FirestorePermissionError({
          operation: "get",
          path: docPath,
        });

        setError(contextualError);
        setData(null);
        setIsLoading(false);

        errorEmitter.emit("permission-error", contextualError);
      }
    );

    return () => {
      indexRegistry?.unregister(registryKey);
      unsubscribe();
    };
  }, [memoizedDocRef, instanceId, indexRegistry]);

  useEffect(() => {
    if (!memoizedDocRef || !indexRegistry) return;
    const docPath =
      typeof memoizedDocRef.path === "string" && memoizedDocRef.path.length > 0
        ? memoizedDocRef.path
        : "(unknown-doc-path)";
    const registryKey = `useDoc:${docPath}:${instanceId}`;
    if (isIndexPending) {
      indexRegistry.register(registryKey);
    } else {
      indexRegistry.unregister(registryKey);
    }
    return () => {
      indexRegistry.unregister(registryKey);
    };
  }, [memoizedDocRef, instanceId, isIndexPending, indexRegistry]);

  return { data, isLoading, error, isIndexPending };
}