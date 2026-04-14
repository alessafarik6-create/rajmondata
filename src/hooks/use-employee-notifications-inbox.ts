"use client";

import { useMemo } from "react";
import { collection, limit, query, where } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";

/** Max. počet dokumentů — řazení a filtry Vše/Nepřečtené/Důležité probíhají na klientovi (jeden jednoduchý dotaz bez composite indexu). */
export const EMPLOYEE_NOTIFICATIONS_INBOX_LIMIT = 100;

const silentListen = { suppressGlobalPermissionError: true as const };

function createdAtToMillis(v: unknown): number {
  if (v == null) return 0;
  if (
    typeof v === "object" &&
    v !== null &&
    "toMillis" in v &&
    typeof (v as { toMillis?: () => number }).toMillis === "function"
  ) {
    const n = (v as { toMillis: () => number }).toMillis();
    return Number.isFinite(n) ? n : 0;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

/**
 * Jednotný zdroj pro panel upozornění i badge: stejná cesta i stejný tvar dotazu.
 *
 * Kolekce: `companies/{companyId}/employee_notifications`
 * Dotaz: `where("employeeId", "==", employeeId)` + `limit` — **bez** `orderBy` (nepotřebuje composite index).
 */
export function useEmployeeNotificationsInbox(params: {
  companyId: string | undefined;
  employeeId: string | undefined;
}) {
  const { companyId, employeeId } = params;
  const firestore = useFirestore();

  const qRef = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "employee_notifications"),
      where("employeeId", "==", employeeId),
      limit(EMPLOYEE_NOTIFICATIONS_INBOX_LIMIT)
    );
  }, [firestore, companyId, employeeId]);

  const { data: raw = [], isLoading, error, isIndexPending } = useCollection(
    qRef,
    silentListen
  );

  /** Nejnovější nahoře — čistě na klientovi. */
  const sortedDocs = useMemo(() => {
    const list = Array.isArray(raw) ? [...raw] : [];
    list.sort(
      (a, b) => createdAtToMillis(b?.createdAt) - createdAtToMillis(a?.createdAt)
    );
    return list;
  }, [raw]);

  const unreadCount = useMemo(
    () => sortedDocs.filter((d: { isRead?: boolean }) => d?.isRead !== true).length,
    [sortedDocs]
  );

  return {
    sortedDocs,
    unreadCount,
    isLoading,
    error,
    isIndexPending,
  };
}
