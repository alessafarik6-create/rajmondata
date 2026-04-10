"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  doc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import type { PayrollOverviewEmployeeRow } from "@/lib/payroll-overview-compute";
import type { EmployeeDailyDetailRow } from "@/lib/attendance-overview-compute";
import {
  type PayrollPeriodPaymentDoc,
  type PayrollPeriodPaymentStatus,
  parsePayrollPeriodPayment,
  paymentStatusBadgeClass,
  paymentStatusLabel,
} from "@/lib/payroll-period-payments";
import { formatKc } from "@/lib/employee-money";
import { getPaymentBadgeLabel } from "@/lib/payroll-entry-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Pencil, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastFn = (opts: {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}) => void;

function dayRowHasPayrollActivity(row: EmployeeDailyDetailRow): boolean {
  return (
    (row.odpracovanoH != null && row.odpracovanoH > 0) ||
    row.tariffSegments.length > 0 ||
    row.jobSegments.length > 0 ||
    row.bloku > 0 ||
    row.orientacniKc > 0.001
  );
}

export function PayrollPeriodPanel(props: {
  firestore: Firestore | null;
  companyId: string;
  userId: string | undefined;
  payrollPeriod: string;
  periodLabel: string;
  periodRangeStr: string;
  overviewRows: PayrollOverviewEmployeeRow[];
  paymentRaw: Record<string, unknown>[] | null | undefined;
  toast: ToastFn;
  dailyDetailByEmployee: ReadonlyMap<string, EmployeeDailyDetailRow[]>;
  autoExpandEmployeeId: string | null;
}) {
  const {
    firestore,
    companyId,
    userId,
    payrollPeriod,
    periodLabel,
    periodRangeStr,
    overviewRows,
    paymentRaw,
    toast,
    dailyDetailByEmployee,
    autoExpandEmployeeId,
  } = props;

  const payments = useMemo(() => {
    const raw = Array.isArray(paymentRaw) ? paymentRaw : [];
    const out: PayrollPeriodPaymentDoc[] = [];
    for (const row of raw) {
      const r = row as { id?: string } & Record<string, unknown>;
      const id = String(r?.id ?? "");
      if (!id) continue;
      const p = parsePayrollPeriodPayment(id, r);
      if (p && p.payrollPeriod === payrollPeriod) out.push(p);
    }
    return out;
  }, [paymentRaw, payrollPeriod]);

  const paymentByEmployee = useMemo(() => {
    const m = new Map<string, PayrollPeriodPaymentDoc>();
    for (const p of payments) m.set(p.employeeId, p);
    return m;
  }, [payments]);

  const mergedRows = useMemo(() => {
    return overviewRows.map((row) => {
      const rec = paymentByEmployee.get(row.employeeId);
      const calculated = Number.isFinite(row.calculatedKc) ? row.calculatedKc : 0;
      const paid = rec ? Number(rec.paidAmount) || 0 : 0;
      const diff = Math.round((calculated - paid) * 100) / 100;
      return {
        ...row,
        record: rec,
        calculatedDisplay: calculated,
        paidDisplay: paid,
        diffDisplay: diff,
      };
    });
  }, [overviewRows, paymentByEmployee]);

  const overviewIdsKey = useMemo(
    () => mergedRows.map((r) => r.employeeId).sort().join(","),
    [mergedRows]
  );

  const [openEmployees, setOpenEmployees] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    const ids = new Set(
      overviewIdsKey.length > 0 ? overviewIdsKey.split(",") : []
    );
    const next: Record<string, boolean> = {};
    if (autoExpandEmployeeId && ids.has(autoExpandEmployeeId)) {
      next[autoExpandEmployeeId] = true;
    }
    setOpenEmployees(next);
  }, [payrollPeriod, periodRangeStr, overviewIdsKey, autoExpandEmployeeId]);

  const setOpen = useCallback((employeeId: string, open: boolean) => {
    setOpenEmployees((prev) => ({ ...prev, [employeeId]: open }));
  }, []);

  const expandAll = useCallback(() => {
    setOpenEmployees(
      Object.fromEntries(mergedRows.map((r) => [r.employeeId, true]))
    );
  }, [mergedRows]);

  const collapseAll = useCallback(() => {
    setOpenEmployees({});
  }, []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEmployeeId, setEditEmployeeId] = useState<string | null>(null);
  const [calcInput, setCalcInput] = useState("");
  const [paidInput, setPaidInput] = useState("");
  const [payDateInput, setPayDateInput] = useState("");
  const [statusInput, setStatusInput] =
    useState<PayrollPeriodPaymentStatus>("unpaid");
  const [noteInput, setNoteInput] = useState("");
  const [saving, setSaving] = useState(false);

  const openFor = (employeeId: string) => {
    const row = overviewRows.find((r) => r.employeeId === employeeId);
    const rec = paymentByEmployee.get(employeeId);
    setEditEmployeeId(employeeId);
    setCalcInput(
      String(rec?.calculatedAmount ?? row?.calculatedKc ?? "").replace(".", ",")
    );
    setPaidInput(String(rec?.paidAmount ?? "").replace(".", ","));
    setPayDateInput(rec?.paymentDate?.slice(0, 10) ?? "");
    setStatusInput(rec?.paymentStatus ?? "unpaid");
    setNoteInput(rec?.paymentNote ?? "");
    setDialogOpen(true);
  };

  useEffect(() => {
    if (!dialogOpen) setEditEmployeeId(null);
  }, [dialogOpen]);

  const save = async () => {
    if (!firestore || !companyId || !userId || !editEmployeeId) return;
    const calculated = parseFloat(String(calcInput).replace(",", ".").trim());
    const paid = parseFloat(String(paidInput).replace(",", ".").trim());
    if (!Number.isFinite(calculated) || calculated < 0) {
      toast({
        variant: "destructive",
        title: "Neplatná vypočtená částka",
      });
      return;
    }
    if (!Number.isFinite(paid) || paid < 0) {
      toast({
        variant: "destructive",
        title: "Neplatná vyplacená částka",
      });
      return;
    }
    const docId = `${editEmployeeId}__${payrollPeriod}`;
    setSaving(true);
    try {
      await setDoc(
        doc(firestore, "companies", companyId, "payroll_period_payments", docId),
        {
          companyId,
          employeeId: editEmployeeId,
          payrollPeriod,
          calculatedAmount: Math.round(calculated * 100) / 100,
          paidAmount: Math.round(paid * 100) / 100,
          paymentDate: payDateInput.trim().slice(0, 10) || "",
          paymentStatus: statusInput,
          paymentNote: noteInput.trim() || "",
          updatedAt: serverTimestamp(),
          updatedBy: userId,
          ...(paymentByEmployee.has(editEmployeeId)
            ? {}
            : { createdAt: serverTimestamp(), createdBy: userId }),
        },
        { merge: true }
      );
      toast({ title: "Výplata uložena" });
      setDialogOpen(false);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
      });
    } finally {
      setSaving(false);
    }
  };

  const resolvedStatus = (row: (typeof mergedRows)[0]) =>
    row.record?.paymentStatus ??
    (row.paidDisplay <= 0
      ? "unpaid"
      : row.paidDisplay + 0.009 >= row.calculatedDisplay
        ? "paid"
        : "partial");

  return (
    <>
      <Card className="border-slate-200 bg-white print:hidden">
        <CardHeader className="space-y-3 pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-lg text-black">
                Přehled výplat za období ({periodLabel})
              </CardTitle>
              <p className="text-sm text-slate-700">
                Sloupce „Vypočteno“ vycházejí ze schválených výkazů a denních výkazů v
                zvoleném měsíci. „Vyplaceno“ a stav evidujte zde — údaje se ukládají
                do databáze. Rozbalením řádku uvidíte rozpis po dnech ({periodRangeStr}).
              </p>
            </div>
            {mergedRows.length > 0 ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-slate-300 text-black"
                  onClick={expandAll}
                >
                  Rozbalit vše
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-slate-300 text-black"
                  onClick={collapseAll}
                >
                  Sbalit vše
                </Button>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {mergedRows.length === 0 ? (
            <p className="text-sm text-slate-700">
              Žádní zaměstnanci ve firmě.
            </p>
          ) : (
            mergedRows.map((row) => {
              const open = Boolean(openEmployees[row.employeeId]);
              const dailyRows = dailyDetailByEmployee.get(row.employeeId) ?? [];
              const activeDays =
                dailyRows.filter(dayRowHasPayrollActivity).length ||
                row.activeDaysCount;
              const st = resolvedStatus(row);

              return (
                <Card
                  key={row.employeeId}
                  className="overflow-hidden border border-slate-200 shadow-sm"
                >
                  <Collapsible
                    open={open}
                    onOpenChange={(v) => setOpen(row.employeeId, v)}
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-start gap-2 border-b border-slate-100 bg-slate-50/90 px-3 py-3 text-left transition-colors hover:bg-slate-100 sm:items-center sm:gap-3 sm:px-4"
                      >
                        <span className="mt-0.5 shrink-0 text-slate-600 sm:mt-0">
                          {open ? (
                            <ChevronUp className="h-5 w-5" aria-hidden />
                          ) : (
                            <ChevronDown className="h-5 w-5" aria-hidden />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-black">
                            {row.displayName || "—"}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                            <span>
                              <span className="text-slate-500">Dny s evidencí:</span>{" "}
                              <strong className="text-slate-800">{activeDays}</strong>
                            </span>
                            <span>
                              <span className="text-slate-500">Hodiny:</span>{" "}
                              <strong className="text-slate-800">
                                {Number.isFinite(row.hoursTotal)
                                  ? `${row.hoursTotal} h`
                                  : "—"}
                              </strong>
                            </span>
                            <span>
                              <span className="text-slate-500">Vypočteno:</span>{" "}
                              <strong className="text-slate-900">
                                {formatKc(row.calculatedDisplay)}
                              </strong>
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <Badge className={paymentStatusBadgeClass(st)}>
                            {paymentStatusLabel(st)}
                          </Badge>
                          <span className="hidden text-[10px] text-slate-500 sm:inline">
                            {payrollPeriod}
                          </span>
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="space-y-4 border-t border-slate-100 bg-white px-3 py-4 sm:px-4">
                        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
                            <p className="text-xs font-medium uppercase text-slate-500">
                              Období uzávěrky
                            </p>
                            <p className="font-mono text-sm text-black">{payrollPeriod}</p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
                            <p className="text-xs font-medium uppercase text-slate-500">
                              Vyplaceno
                            </p>
                            <p className="tabular-nums text-sm font-semibold text-black">
                              {formatKc(row.paidDisplay)}
                            </p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
                            <p className="text-xs font-medium uppercase text-slate-500">
                              Doplatek
                            </p>
                            <p
                              className={cn(
                                "tabular-nums text-sm font-semibold",
                                row.diffDisplay > 0.009
                                  ? "text-amber-800"
                                  : "text-slate-800"
                              )}
                            >
                              {formatKc(row.diffDisplay)}
                            </p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
                            <p className="text-xs font-medium uppercase text-slate-500">
                              Datum výplaty
                            </p>
                            <p className="text-sm text-black">
                              {row.record?.paymentDate?.trim()
                                ? row.record.paymentDate
                                : "—"}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2 print:hidden">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="min-h-10 border-slate-300"
                            onClick={() => openFor(row.employeeId)}
                          >
                            <Pencil className="mr-1 h-4 w-4" />
                            Evidovat výplatu
                          </Button>
                        </div>

                        <div>
                          <p className="mb-2 text-sm font-semibold text-black">
                            Rozpis po dnech ({periodRangeStr})
                          </p>
                          {dailyRows.length === 0 ? (
                            <p className="text-sm text-slate-600">
                              Pro tohoto zaměstnance nejsou v tomto období žádné denní řádky.
                            </p>
                          ) : (
                            <>
                              <div className="hidden overflow-x-auto md:block">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="text-black">Den</TableHead>
                                      <TableHead className="text-black">Odprac. (h)</TableHead>
                                      <TableHead className="text-black">Schváleno</TableHead>
                                      <TableHead className="text-black">Výplata</TableHead>
                                      <TableHead className="text-black">Bloky</TableHead>
                                      <TableHead className="text-black">Schv. Kč</TableHead>
                                      <TableHead className="text-black">Neschv. Kč</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {dailyRows.map((drow) => (
                                      <TableRow key={drow.key}>
                                        <TableCell className="whitespace-nowrap text-black">
                                          {drow.dayTitle}
                                        </TableCell>
                                        <TableCell className="text-black">
                                          {drow.odpracovanoH != null
                                            ? `${drow.odpracovanoH} h`
                                            : "—"}
                                        </TableCell>
                                        <TableCell className="text-black">
                                          <Badge
                                            variant={
                                              drow.schvalenoStatus === "approved"
                                                ? "default"
                                                : drow.schvalenoStatus === "pending"
                                                  ? "secondary"
                                                  : "outline"
                                            }
                                            className="font-normal"
                                          >
                                            {drow.schvalenoStatus === "approved"
                                              ? "Schváleno"
                                              : drow.schvalenoStatus === "pending"
                                                ? "Čeká"
                                                : "—"}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-black">
                                          <Badge
                                            variant={
                                              drow.paidStatus === "paid"
                                                ? "default"
                                                : drow.paidStatus === "unpaid"
                                                  ? "secondary"
                                                  : "outline"
                                            }
                                            className="font-normal"
                                          >
                                            {getPaymentBadgeLabel(drow.paidStatus)}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-black">{drow.bloku}</TableCell>
                                        <TableCell className="text-black">
                                          {formatKc(drow.schvalenoKc)}
                                        </TableCell>
                                        <TableCell className="text-black">
                                          {formatKc(drow.neschvalenoKc)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                              <div className="space-y-3 md:hidden">
                                {dailyRows.map((drow) => (
                                  <div
                                    key={drow.key}
                                    className="rounded-md border border-slate-200 p-3 text-sm"
                                  >
                                    <p className="font-semibold text-black">{drow.dayTitle}</p>
                                    <p className="text-slate-700">
                                      Odpracováno:{" "}
                                      {drow.odpracovanoH != null
                                        ? `${drow.odpracovanoH} h`
                                        : "—"}
                                    </p>
                                    <p className="mt-1 flex flex-wrap items-center gap-2 text-slate-700">
                                      <Badge
                                        variant={
                                          drow.schvalenoStatus === "approved"
                                            ? "default"
                                            : drow.schvalenoStatus === "pending"
                                              ? "secondary"
                                              : "outline"
                                        }
                                      >
                                        {drow.schvalenoStatus === "approved"
                                          ? "Schváleno"
                                          : drow.schvalenoStatus === "pending"
                                            ? "Čeká"
                                            : "—"}
                                      </Badge>
                                      <Badge
                                        variant={
                                          drow.paidStatus === "paid"
                                            ? "default"
                                            : drow.paidStatus === "unpaid"
                                              ? "secondary"
                                              : "outline"
                                        }
                                      >
                                        {getPaymentBadgeLabel(drow.paidStatus)}
                                      </Badge>
                                    </p>
                                    <p className="mt-1 text-slate-700">
                                      Bloky: {drow.bloku} · Schv. {formatKc(drow.schvalenoKc)} ·
                                      Neschv. {formatKc(drow.neschvalenoKc)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg border-slate-200 bg-white text-black">
          <DialogHeader>
            <DialogTitle>Evidovat / upravit výplatu</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Období</Label>
              <Input readOnly value={payrollPeriod} className="bg-slate-50" />
            </div>
            <div>
              <Label>Vypočtená částka (Kč)</Label>
              <Input
                value={calcInput}
                onChange={(e) => setCalcInput(e.target.value)}
                inputMode="decimal"
                placeholder="např. 28500"
              />
            </div>
            <div>
              <Label>Skutečně vyplaceno (Kč)</Label>
              <Input
                value={paidInput}
                onChange={(e) => setPaidInput(e.target.value)}
                inputMode="decimal"
                placeholder="např. 20000"
              />
            </div>
            <div>
              <Label>Datum výplaty</Label>
              <Input
                type="date"
                value={payDateInput}
                onChange={(e) => setPayDateInput(e.target.value)}
              />
            </div>
            <div>
              <Label>Stav výplaty</Label>
              <select
                className="flex h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-black"
                value={statusInput}
                onChange={(e) =>
                  setStatusInput(e.target.value as PayrollPeriodPaymentStatus)
                }
              >
                <option value="unpaid">Nevyplaceno</option>
                <option value="partial">Částečně vyplaceno</option>
                <option value="paid">Vyplaceno</option>
              </select>
            </div>
            <div>
              <Label>Poznámka</Label>
              <Textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                rows={3}
                placeholder="Volitelně…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Zrušit
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Uložit"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
