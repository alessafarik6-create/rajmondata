"use client";

import { useEffect, useState } from "react";

export type EmailCustomerSearchRow = { id: string; label: string };

export function useEmailCustomerSearch(params: {
  companyId: string;
  enabled: boolean;
  query: string;
  getToken: () => Promise<string>;
  debounceMs?: number;
}) {
  const [customers, setCustomers] = useState<EmailCustomerSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(params.query);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(params.query), params.debounceMs ?? 300);
    return () => window.clearTimeout(t);
  }, [params.query, params.debounceMs]);

  useEffect(() => {
    if (!params.enabled || !params.companyId) {
      setCustomers([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const token = await params.getToken();
        const res = await fetch(
          `/api/company/email-mailbox/customers-search?companyId=${encodeURIComponent(params.companyId)}&q=${encodeURIComponent(debouncedQuery.trim())}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = (await res.json()) as {
          ok?: boolean;
          customers?: EmailCustomerSearchRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setCustomers([]);
          setError(data.error ?? "Nepodařilo se načíst zákazníky.");
          return;
        }
        setCustomers(data.customers ?? []);
      } catch {
        if (!cancelled) setError("Chyba sítě.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.enabled, params.companyId, debouncedQuery, params.getToken]);

  return { customers, loading, error };
}
