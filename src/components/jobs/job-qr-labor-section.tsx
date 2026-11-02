"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useUser } from "@/firebase";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type LaborSummary = {
  rows: Array<{
    employeeName: string;
    operationName: string;
    hours: number;
    internalRateCzk: number;
    laborCostCzk: number;
    workDateIso: string;
  }>;
  totalHours: number;
  totalCostCzk: number;
  byEmployee: Array<{ name: string; hours: number; costCzk: number }>;
  byOperation: Array<{ name: string; hours: number; costCzk: number }>;
};

export function JobQrLaborSection(props: {
  companyId: string;
  jobId: string;
  canViewCosts: boolean;
}) {
  const { user } = useUser();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LaborSummary | null>(null);

  useEffect(() => {
    if (!user || !props.companyId || !props.jobId) return;
    void (async () => {
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/company/labor/job-qr-labor?jobId=${encodeURIComponent(props.jobId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const j = (await res.json()) as LaborSummary & { ok?: boolean };
        setData(j.ok !== false ? j : null);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [user, props.companyId, props.jobId]);

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        Zatím nejsou uzavřené QR intervaly práce na této zakázce.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        <p>
          Celkem odpracováno (QR): <strong>{data.totalHours} h</strong>
        </p>
        {props.canViewCosts ? (
          <p>
            Celkem náklady práce: <strong>{data.totalCostCzk} Kč</strong>
          </p>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Zaměstnanec</TableHead>
              <TableHead>Operace</TableHead>
              <TableHead>Hodiny</TableHead>
              {props.canViewCosts ? (
                <>
                  <TableHead>Sazba</TableHead>
                  <TableHead>Náklad</TableHead>
                </>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r, i) => (
              <TableRow key={`${r.workDateIso}-${r.employeeName}-${i}`}>
                <TableCell>{r.workDateIso}</TableCell>
                <TableCell>{r.employeeName}</TableCell>
                <TableCell>{r.operationName}</TableCell>
                <TableCell>{r.hours} h</TableCell>
                {props.canViewCosts ? (
                  <>
                    <TableCell>{r.internalRateCzk} Kč/h</TableCell>
                    <TableCell>{r.laborCostCzk} Kč</TableCell>
                  </>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Náklady z QR intervalů; schválené výkazy a terminálové úseky mohou být účtovány samostatně bez
        duplicity.
      </p>
    </div>
  );
}
