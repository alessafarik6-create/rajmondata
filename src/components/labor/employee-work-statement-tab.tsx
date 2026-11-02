"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { cs } from "date-fns/locale";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type {
  WorkStatementAnomaly,
  WorkStatementHoursBySource,
  WorkStatementIntervalRow,
  WorkStatementSummary,
} from "@/lib/labor/employee-work-statement";
import {
  exportWorkStatementCsv,
  exportWorkStatementPdf,
  exportWorkStatementXlsx,
} from "@/lib/labor/employee-work-statement-export";

type Props = {
  companyId: string;
  employeeId: string;
  employeeName: string;
  organizationName: string;
  canExportMoney: boolean;
};

export function EmployeeWorkStatementTab(props: Props) {
  const { user } = useUser();
  const today = new Date();
  const [fromIso, setFromIso] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [toIso, setToIso] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<WorkStatementIntervalRow[]>([]);
  const [hoursBySource, setHoursBySource] = useState<WorkStatementHoursBySource | null>(null);
  const [summary, setSummary] = useState<WorkStatementSummary | null>(null);
  const [anomalies, setAnomalies] = useState<WorkStatementAnomaly[]>([]);
  const [includeMoney, setIncludeMoney] = useState(false);
  const [filterJob, setFilterJob] = useState("");
  const [filterSource, setFilterSource] = useState<"" | "qr" | "manual">("");

  const load = useCallback(async () => {
    if (!user || !props.companyId || !props.employeeId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const qs = new URLSearchParams({
        companyId: props.companyId,
        employeeId: props.employeeId,
        from: fromIso,
        to: toIso,
      });
      const res = await fetch(`/api/company/labor/employee-work-statement?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        intervalRows?: WorkStatementIntervalRow[];
        hoursBySource?: WorkStatementHoursBySource;
        summary?: WorkStatementSummary;
        anomalies?: WorkStatementAnomaly[];
        includeMoney?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Načtení selhalo.");
      setRows(data.intervalRows ?? []);
      setHoursBySource(data.hoursBySource ?? null);
      setSummary(data.summary ?? null);
      setAnomalies(data.anomalies ?? []);
      setIncludeMoney(data.includeMoney === true);
    } catch (e) {
      setRows([]);
      setHoursBySource(null);
      setSummary(null);
      setAnomalies([]);
    } finally {
      setLoading(false);
    }
  }, [user, props.companyId, props.employeeId, fromIso, toIso]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (filterJob.trim()) {
      const q = filterJob.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.jobName.toLowerCase().includes(q) ||
          r.jobNumber.toLowerCase().includes(q) ||
          r.jobId.toLowerCase().includes(q)
      );
    }
    if (filterSource) list = list.filter((r) => r.source === filterSource);
    return list;
  }, [rows, filterJob, filterSource]);

  const exportBase = `pracovni-vykaz-${props.employeeId}-${fromIso}`;

  const doExport = (kind: "csv" | "xlsx" | "pdf") => {
    if (!hoursBySource || !summary) return;
    const exportedBy = user?.email ?? user?.uid ?? "—";
    if (kind === "csv") {
      exportWorkStatementCsv(filteredRows, exportBase, includeMoney && props.canExportMoney);
    } else if (kind === "xlsx") {
      exportWorkStatementXlsx({
        employeeName: props.employeeName,
        organizationName: props.organizationName,
        fromIso,
        toIso,
        rows: filteredRows,
        hoursBySource,
        summary,
        anomalies,
        includeMoney: includeMoney && props.canExportMoney,
        exportedBy,
        fileName: exportBase,
      });
    } else {
      exportWorkStatementPdf({
        employeeName: props.employeeName,
        organizationName: props.organizationName,
        fromIso,
        toIso,
        rows: filteredRows,
        hoursBySource,
        includeMoney: includeMoney && props.canExportMoney,
        exportedBy,
        fileName: exportBase,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Od</Label>
          <Input type="date" value={fromIso} onChange={(e) => setFromIso(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Do</Label>
          <Input type="date" value={toIso} onChange={(e) => setToIso(e.target.value)} />
        </div>
        <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Obnovit"}
        </Button>
        <div className="flex flex-wrap gap-2 ml-auto">
          <Button type="button" size="sm" variant="outline" onClick={() => doExport("csv")}>
            <FileDown className="mr-1 h-4 w-4" /> CSV
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => doExport("xlsx")}>
            <FileDown className="mr-1 h-4 w-4" /> Excel
          </Button>
          <Button type="button" size="sm" className="bg-orange-600 hover:bg-orange-700" onClick={() => doExport("pdf")}>
            <FileDown className="mr-1 h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      {hoursBySource ? (
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p className="font-semibold">Odpracované hodiny podle zdroje</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            <li>Uznáno pro mzdu: <strong>{hoursBySource.recognizedPayableHours} h</strong></li>
            <li>Docházka (netto): <strong>{hoursBySource.attendanceNetHours} h</strong></li>
            <li>Terminál (úseky): <strong>{hoursBySource.terminalSegmentHours} h</strong></li>
            <li>QR na zakázkách: <strong>{hoursBySource.qrJobHours} h</strong></li>
            <li>Nepřiřazeno k zakázce: <strong>{hoursBySource.unassignedToJobHours} h</strong></li>
            <li>Čeká na schválení: <strong>{hoursBySource.pendingApprovalHours} h</strong></li>
          </ul>
          <p className="text-xs text-muted-foreground">
            QR hodiny jsou rozpad práce na zakázkách — nesčítají se k uznávaným hodinám pro mzdu.
          </p>
        </div>
      ) : null}

      {summary ? (
        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <div className="rounded border p-2">QR celkem: <strong>{summary.totalQrHours} h</strong></div>
          <div className="rounded border p-2">Dnů: <strong>{summary.distinctWorkDays}</strong></div>
          <div className="rounded border p-2">Zakázek: <strong>{summary.distinctJobs}</strong></div>
        </div>
      ) : null}

      {anomalies.length > 0 ? (
        <div className="space-y-2">
          {anomalies.slice(0, 8).map((a, i) => (
            <Alert key={`${a.code}-${i}`} variant={a.severity === "critical" ? "destructive" : "default"}>
              <AlertTitle>Nesrovnalost</AlertTitle>
              <AlertDescription>{a.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs h-9"
          placeholder="Filtr zakázky…"
          value={filterJob}
          onChange={(e) => setFilterJob(e.target.value)}
        />
        <select
          className="h-9 rounded-md border px-2 text-sm"
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value as "" | "qr" | "manual")}
        >
          <option value="">Všechny zdroje</option>
          <option value="qr">QR</option>
          <option value="manual">Ruční</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Zakázka</TableHead>
              <TableHead>Operace</TableHead>
              <TableHead>Od</TableHead>
              <TableHead>Do</TableHead>
              <TableHead>Odpracováno</TableHead>
              {includeMoney && props.canExportMoney ? (
                <>
                  <TableHead>Tarif</TableHead>
                  <TableHead>Částka</TableHead>
                </>
              ) : null}
              <TableHead>Zdroj</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-6 text-muted-foreground">
                  Žádné záznamy v období.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{format(new Date(r.workDateIso), "d. M. yyyy", { locale: cs })}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-orange-700">{r.jobNumber || "—"}</span>
                    <br />
                    <span className="text-xs">{r.jobName}</span>
                  </TableCell>
                  <TableCell>{r.operationName}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(r.startedAtIso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {r.endedAtIso
                      ? new Date(r.endedAtIso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </TableCell>
                  <TableCell>{r.durationLabel}</TableCell>
                  {includeMoney && props.canExportMoney ? (
                    <>
                      <TableCell>{r.hourlyRateCzk != null ? `${r.hourlyRateCzk} Kč/h` : "—"}</TableCell>
                      <TableCell>{r.amountCzk != null ? `${r.amountCzk} Kč` : "—"}</TableCell>
                    </>
                  ) : null}
                  <TableCell className="uppercase text-xs">{r.source}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
