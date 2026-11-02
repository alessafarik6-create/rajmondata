"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useUser } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkStatementHoursBySource } from "@/lib/labor/employee-work-statement";

export function PayrollHoursBySourceCard(props: {
  companyId: string;
  employeeId: string | null;
  fromIso: string;
  toIso: string;
}) {
  const { user } = useUser();
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState<WorkStatementHoursBySource | null>(null);

  useEffect(() => {
    if (!user || !props.companyId || !props.employeeId) {
      setHours(null);
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const qs = new URLSearchParams({
          employeeId: props.employeeId!,
          from: props.fromIso,
          to: props.toIso,
        });
        const res = await fetch(`/api/company/labor/employee-work-statement?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as {
          ok?: boolean;
          hoursBySource?: WorkStatementHoursBySource;
        };
        setHours(data.ok ? data.hoursBySource ?? null : null);
      } catch {
        setHours(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [user, props.companyId, props.employeeId, props.fromIso, props.toIso]);

  if (!props.employeeId) return null;

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-black">Odpracované hodiny podle zdroje</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
        ) : hours ? (
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            <li>
              Celkem uznáno pro mzdu: <strong>{hours.recognizedPayableHours} h</strong>
            </li>
            <li>
              Docházka (terminál): <strong>{hours.attendanceNetHours} h</strong>
            </li>
            <li>
              QR zakázky (alokace): <strong>{hours.qrJobHours} h</strong>
            </li>
            <li>
              Nepřiřazeno k zakázce: <strong>{hours.unassignedToJobHours} h</strong>
            </li>
            <li>
              Terminálové úseky: <strong>{hours.terminalSegmentHours} h</strong>
            </li>
            <li>
              Čeká na schválení: <strong>{hours.pendingApprovalHours} h</strong>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nepodařilo se načíst rozpis hodin.</p>
        )}
        <p className="mt-2 text-xs text-slate-600">
          QR hodiny slouží k přiřazení práce na zakázky — nejsou přičteny k uznávaným hodinám pro výplatu.
        </p>
      </CardContent>
    </Card>
  );
}
