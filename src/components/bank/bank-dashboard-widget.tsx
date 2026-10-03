"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Landmark } from "lucide-react";
import { useUser, useCompany } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";

export function BankDashboardWidget() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const access = usePortalModuleAccess("bank");
  const [summary, setSummary] = useState<{
    balance: number;
    unmatched: number;
  } | null>(null);

  useEffect(() => {
    if (!access.canRead || !user || !companyId) return;
    let cancelled = false;
    (async () => {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/bank/overview?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (cancelled || !json.ok) return;
      const accounts = json.accounts ?? [];
      const balance = accounts.reduce(
        (s: number, a: { balance?: number }) => s + (Number(a.balance) || 0),
        0
      );
      setSummary({ balance, unmatched: json.summary?.unmatchedCount ?? 0 });
    })();
    return () => {
      cancelled = true;
    };
  }, [access.canRead, user, companyId]);

  if (!access.canRead) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="portal-section-label text-sm font-medium">Banka</CardTitle>
        <Landmark className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="portal-kpi-value">
          {(summary?.balance ?? 0).toLocaleString("cs-CZ")} Kč
        </div>
        <p className="portal-kpi-label">
          Nespárované transakce: {summary?.unmatched ?? "—"}
        </p>
        <Link href="/portal/bank" className="text-sm text-primary underline-offset-2 hover:underline">
          Otevřít banku
        </Link>
      </CardContent>
    </Card>
  );
}
