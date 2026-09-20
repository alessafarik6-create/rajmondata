"use client";

import { useEffect, useState } from "react";

export type EmailJobSearchRow = {
  id: string;
  orderNumber: string;
  title: string;
  customerName: string;
  address: string;
  label: string;
};

export function useEmailJobSearch(params: {
  companyId: string;
  enabled: boolean;
  query: string;
  getToken: () => Promise<string>;
  debounceMs?: number;
}) {
  const [jobs, setJobs] = useState<EmailJobSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(params.query);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(params.query), params.debounceMs ?? 300);
    return () => window.clearTimeout(t);
  }, [params.query, params.debounceMs]);

  useEffect(() => {
    if (!params.enabled || !params.companyId) {
      setJobs([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const token = await params.getToken();
        const qParam = debouncedQuery.trim();
        const res = await fetch(
          `/api/company/email-mailbox/jobs-search?companyId=${encodeURIComponent(params.companyId)}&q=${encodeURIComponent(qParam)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = (await res.json()) as {
          ok?: boolean;
          jobs?: EmailJobSearchRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setJobs([]);
          setError(data.error ?? "Nepodařilo se načíst zakázky.");
          return;
        }
        setJobs(data.jobs ?? []);
        setError(null);
      } catch {
        if (!cancelled) {
          setJobs([]);
          setError("Nepodařilo se načíst zakázky.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.enabled, params.companyId, debouncedQuery, params.getToken]);

  return { jobs, loading, error };
}
