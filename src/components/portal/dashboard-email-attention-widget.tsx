"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail } from "lucide-react";

type Stats = {
  waitingReply: number;
  overdue: number;
  assignedToMe: number;
  urgent: number;
};

export function DashboardEmailAttentionWidget({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const [stats, setStats] = useState<Stats | null>(null);

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
            overdue: data.overdue ?? 0,
            assignedToMe: data.assignedToMe ?? 0,
            urgent: data.urgent ?? 0,
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

  if (!stats || (stats.waitingReply === 0 && stats.overdue === 0 && stats.assignedToMe === 0 && stats.urgent === 0)) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4" /> E-maily k vyřízení
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        {stats.waitingReply > 0 ? (
          <p>
            <Link href="/portal/email?view=waiting_reply" className="text-primary hover:underline">
              Čeká na odpověď: {stats.waitingReply}
            </Link>
          </p>
        ) : null}
        {stats.overdue > 0 ? (
          <p>
            <Link href="/portal/email?view=waiting_reply" className="text-primary hover:underline">
              Po termínu: {stats.overdue}
            </Link>
          </p>
        ) : null}
        {stats.assignedToMe > 0 ? (
          <p>
            <Link href="/portal/email?view=assigned_to_me" className="text-primary hover:underline">
              Přiřazené mně: {stats.assignedToMe}
            </Link>
          </p>
        ) : null}
        {stats.urgent > 0 ? (
          <p>
            <Link href="/portal/email" className="text-primary hover:underline">
              Urgentní: {stats.urgent}
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
