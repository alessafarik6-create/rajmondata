"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  doc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import type { PayrollOverviewEmployeeRow } from "@/lib/payroll-overview-compute";
import {
  type PayrollPeriodPaymentDoc,
  type PayrollPeriodPaymentStatus,
  parsePayrollPeriodPayment,
  paymentStatusBadgeClass,
  paymentStatusLabel,
} from "@/lib/payroll-period-payments";
import { formatKc } from "@/lib/employee-money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastFn = (opts: {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}) => void;

export function PayrollPeriodPanel(props: {
  firestore: Firestore | null;
  companyId: string;
  userId: string | undefined;
  payrollPeriod: string;
  periodLabel: string;
  overviewRows: PayrollOverviewEmployeeRow[];
  paymentRaw: Record<string, unknown>[] | null | undefined;
  toast: ToastFn;
}) {
  const {
    firestore,
    companyId,
    userId,
    payrollPeriod,
    periodLabel,
    overviewRows,
    paymentRaw,
    toast,
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

  return (
    <>
      <Card className="border-slate-200 bg-white print:hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg text-black">
            Přehled výplat za období ({periodLabel})
          </CardTitle>
          <p className="text-sm text-slate-700">
            Sloupce „Vypočteno“ vycházejí ze schválených výkazů a denních výkazů v
            zvoleném měsíci. „Vyplaceno“ a stav evidujte zde — údaje se ukládají
            do databáze.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {mergedRows.length === 0 ? (
            <p className="text-sm text-slate-700">
              Žádní zaměstnanci ve firmě.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-black">Zaměstnanec</TableHead>
                  <TableHead className="text-black">Období</TableHead>
                  <TableHead className="text-black">Hodiny</TableHead>
                  <TableHead className="text-black">Vypočteno</TableHead>
                  <TableHead className="text-black">Vyplaceno</TableHead>
                  <TableHead className="text-black">Doplatek</TableHead>
                  <TableHead className="text-black">Stav</TableHead>
                  <TableHead className="text-black">Datum výplaty</TableHead>
                  <TableHead className="w-[100px] print:hidden">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mergedRows.map((row) => (
                  <TableRow key={row.employeeId}>
                    <TableCell className="font-medium text-black">
                      {row.displayName || "—"}
                    </TableCell>
                    <TableCell className="text-black">{payrollPeriod}</TableCell>
                    <TableCell className="tabular-nums text-black">
                      {Number.isFinite(row.hoursTotal) ? row.hoursTotal : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-black">
                      {formatKc(row.calculatedDisplay)}
                    </TableCell>
                    <TableCell className="tabular-nums text-black">
                      {formatKc(row.paidDisplay)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular-nums font-medium",
                        row.diffDisplay > 0.009
                          ? "text-amber-800"
                          : "text-slate-800"
                      )}
                    >
                      {formatKc(row.diffDisplay)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={paymentStatusBadgeClass(
                          row.record?.paymentStatus ??
                            (row.paidDisplay <= 0
                              ? "unpaid"
                              : row.paidDisplay + 0.009 >= row.calculatedDisplay
                                ? "paid"
                                : "partial")
                        )}
                      >
                        {paymentStatusLabel(
                          row.record?.paymentStatus ??
                            (row.paidDisplay <= 0
                              ? "unpaid"
                              : row.paidDisplay + 0.009 >= row.calculatedDisplay
                                ? "paid"
                                : "partial")
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-black">
                      {row.record?.paymentDate?.trim()
                        ? row.record.paymentDate
                        : "—"}
                    </TableCell>
                    <TableCell className="print:hidden">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-10 border-slate-300"
                        onClick={() => openFor(row.employeeId)}
                      >
                        <Pencil className="mr-1 h-4 w-4" />
                        Evidovat
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
