"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { Firestore } from "firebase/firestore";
import { doc, getDoc } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { CustomerJobProgressCard } from "@/components/customer/customer-job-progress-card";
import { canCustomerAccessJob } from "@/lib/job-customer-access";
import { Button } from "@/components/ui/button";

type ProfileLike = Parameters<typeof canCustomerAccessJob>[1];

type Row = {
  id: string;
  data: Record<string, unknown>;
};

type Props = {
  firestore: Firestore | null;
  companyId: string | null | undefined;
  customerUid: string;
  profile: ProfileLike | null | undefined;
  linkedJobIds: string[];
};

export function CustomerLinkedJobsProgress({
  firestore,
  companyId,
  customerUid,
  profile,
  linkedJobIds,
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !companyId || !profile || linkedJobIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const list: Row[] = [];
      for (const jid of linkedJobIds) {
        if (cancelled) return;
        try {
          const ref = doc(firestore, "companies", companyId, "jobs", jid);
          const snap = await getDoc(ref);
          if (!snap.exists() || cancelled) continue;
          const data = snap.data() as Record<string, unknown>;
          if (
            canCustomerAccessJob(customerUid, profile, {
              ...data,
              id: jid,
            })
          ) {
            list.push({ id: jid, data });
          }
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) {
        setRows(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, customerUid, profile, linkedJobIds]);

  if (!companyId || linkedJobIds.length === 0) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Načítání" />
      </div>
    );
  }

  if (rows.length === 0) {
    return null;
  }

  if (rows.length === 1) {
    const r = rows[0];
    const name = typeof r.data.name === "string" && r.data.name.trim() ? r.data.name.trim() : r.id;
    return (
      <section className="space-y-4" aria-labelledby="customer-progress-heading">
        <h2 id="customer-progress-heading" className="portal-page-title text-xl sm:text-2xl">
          Průběh zakázky
        </h2>
        <div className="space-y-3">
          <CustomerJobProgressCard jobId={r.id} jobName={name} jobData={r.data} />
          <Button variant="outline" size="sm" asChild>
            <Link href={`/portal/customer/jobs/${r.id}`}>Detail zakázky</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="customer-progress-multi-heading">
      <div>
        <h2 id="customer-progress-multi-heading" className="portal-page-title text-xl sm:text-2xl">
          Průběh vašich zakázek
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          U každé zakázky vidíte dokončení a sdílené fotografie průběhu.
        </p>
      </div>
      {rows.map((r) => {
        const name = typeof r.data.name === "string" && r.data.name.trim() ? r.data.name.trim() : r.id;
        return (
          <div key={r.id} className="space-y-3">
            <CustomerJobProgressCard jobId={r.id} jobName={name} jobData={r.data} />
            <Button variant="outline" size="sm" asChild>
              <Link href={`/portal/customer/jobs/${r.id}`}>Detail zakázky</Link>
            </Button>
          </div>
        );
      })}
    </section>
  );
}
