"use client";

import React, { useCallback, useEffect, useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { FileDown, Loader2 } from "lucide-react";
import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadCsvFromRows } from "@/lib/csv-download";

type Row = {
  employeeId: string;
  displayName: string;
  attendanceHours: number;
  qrHours: number;
  unassignedHours: number;
  earningsKc: number | null;
  anomalyFlags: number;
};

export function LaborPayrollWorkOverviewTable(props: { companyId: string }) {
  const { user } = useUser();
  const today = new Date();
  const [fromIso, setFromIso] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [toIso, setToIso] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    if (!user || !props.companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const qs = new URLSearchParams({ from: fromIso, to: toIso });
      const res = await fetch(`/api/company/labor/payroll-work-overview?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { ok?: boolean; rows?: Row[] };
      setRows(data.ok ? data.rows ?? [] : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user, props.companyId, fromIso, toIso]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = () => {
    downloadCsvFromRows(
      [
        [
          "Zaměstnanec",
          "Docházka h",
          "QR h",
          "Nepřiřazeno h",
          "Výdělek Kč",
          "Upozornění",
        ],
        ...rows.map((r) => [
          r.displayName,
          String(r.attendanceHours),
          String(r.qrHours),
          String(r.unassignedHours),
          r.earningsKc != null ? String(r.earningsKc) : "",
          String(r.anomalyFlags),
        ]),
      ],
      `prehled-zamestnanci-${fromIso}-${toIso}`
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Od</Label>
          <Input type="date" value={fromIso} onChange={(e) => setFromIso(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Do</Label>
          <Input type="date" value={toIso} onChange={(e) => setToIso(e.target.value)} />
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          Obnovit
        </Button>
        <Button type="button" className="bg-orange-600 hover:bg-orange-700" onClick={exportCsv} disabled={!rows.length}>
          <FileDown className="mr-1 h-4 w-4" /> Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zaměstnanec</TableHead>
              <TableHead>Docházka</TableHead>
              <TableHead>QR hodiny</TableHead>
              <TableHead>Nepřiřazené</TableHead>
              <TableHead>Výdělek</TableHead>
              <TableHead>Stav</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Žádná data.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell className="font-medium">{r.displayName}</TableCell>
                  <TableCell>{r.attendanceHours} h</TableCell>
                  <TableCell>{r.qrHours} h</TableCell>
                  <TableCell>{r.unassignedHours} h</TableCell>
                  <TableCell>{r.earningsKc != null ? `${r.earningsKc} Kč` : "—"}</TableCell>
                  <TableCell>{r.anomalyFlags > 0 ? "Ke kontrole" : "OK"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
