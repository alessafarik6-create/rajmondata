"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail } from "lucide-react";

export function DashboardEmailAttentionWidget({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const [stats, setStats] = useState<{ waitingReply: number; assignedToJobs: number; aiImportant: number } | null>(
    null
  );

  useEffect(() => {
    if (!user || !companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/company/email-mailbox/stats?companyId=${encodeURIComponent(companyId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        if (!cancelled && data.ok) {
          setStats({
            waitingReply: data.waitingReply ?? 0,
            assignedToJobs: data.assignedToJobs ?? 0,
            aiImportant: data.aiImportant ?? 0,
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, companyId]);

  if (!stats || (stats.waitingReply === 0 && stats.assignedToJobs === 0 && stats.aiImportant === 0)) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4" /> E-mail vyžaduje pozornost
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        {stats.waitingReply > 0 ? (
          <p>
            <Link href="/portal/email" className="text-primary hover:underline">
              {stats.waitingReply} zpráv čeká na odpověď
            </Link>
          </p>
        ) : null}
        {stats.assignedToJobs > 0 ? (
          <p>
            <Link href="/portal/email" className="text-primary hover:underline">
              {stats.assignedToJobs} nových zpráv k zakázkám
            </Link>
          </p>
        ) : null}
        {stats.aiImportant > 0 ? (
          <p>
            <Link href="/portal/email" className="text-primary hover:underline">
              {stats.aiImportant} důležitých upozornění od AI
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
