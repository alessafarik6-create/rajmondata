"use client";

import React, { useMemo, useState } from "react";
import { collection, query, where, limit } from "firebase/firestore";
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, AlertCircle } from "lucide-react";
import { formatKc } from "@/lib/employee-money";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const FETCH_LIMIT_DEBTS = 300;
const FETCH_LIMIT_PAYMENTS = 500;
const FETCH_LIMIT_HISTORY = 200;
const NOTE_PREVIEW_LEN = 100;

const silentListen = { suppressGlobalPermissionError: true as const };

const DEBT_REASON_LABEL: Record<string, string> = {
  tool_damage: "Poškození nářadí",
  loan: "Půjčka",
  deduction: "Srážka",
  other: "Jiné",
};

type DebtReason = "tool_damage" | "loan" | "deduction" | "other";

export type EmployeeDebtReadRow = {
  id: string;
  employeeId: string;
  amount: number;
  originalAmount?: number;
  remainingAmount: number;
  date: string;
  note: string;
  reason: DebtReason;
  status: "active" | "paid" | "overpaid";
  createdAt?: unknown;
  paidAt?: unknown;
  paidBy?: string;
  paidByName?: string;
};

export type EmployeeDebtPaymentReadRow = {
  id: string;
  debtId: string;
  employeeId: string;
  amount: number;
  date: string;
  note: string;
  paidAt?: unknown;
  paidBy?: string;
  paymentMethod?: string;
};

export type EmployeeDebtHistoryReadRow = {
  id: string;
  debtId: string;
  employeeId: string;
  companyId: string;
  originalAmount: number;
  debtDate: string;
  debtNote: string;
  closureNote: string;
  settlementMethod: string | null;
  paidAt?: unknown;
  paidBy: string;
  paidByName: string | null;
  status: "paid" | "overpaid";
};

function parseDebtReason(raw: unknown): DebtReason {
  const s = String(raw ?? "");
  return ["tool_damage", "loan", "deduction", "other"].includes(s)
    ? (s as DebtReason)
    : "other";
}

function debtStatusFromDoc(d: {
  remainingAmount: number;
  status?: unknown;
}): "active" | "paid" | "overpaid" {
  const rem = Number(d.remainingAmount) || 0;
  if (rem < 0) return "overpaid";
  if (rem > 0) return "active";
  const st = String(d.status ?? "");
  if (st === "overpaid") return "overpaid";
  return "paid";
}

function createdSortMs(d: EmployeeDebtReadRow): number {
  const v = d.createdAt;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
  if (v && typeof (v as { toDate?: () => Date }).toDate === "function") {
    try {
      const t = (v as { toDate: () => Date }).toDate();
      if (t instanceof Date && !Number.isNaN(t.getTime())) return t.getTime();
    } catch {
      /* ignore */
    }
  }
  const ds = String(d.date ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
    const [y, m, day] = ds.split("-").map(Number);
    return new Date(y, m - 1, day, 12, 0, 0, 0).getTime();
  }
  return 0;
}

function formatTs(v: unknown): string {
  if (!v) return "—";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return format(v, "d. M. yyyy HH:mm", { locale: cs });
  }
  if (v && typeof (v as { toDate?: () => Date }).toDate === "function") {
    try {
      const t = (v as { toDate: () => Date }).toDate();
      if (t instanceof Date && !Number.isNaN(t.getTime())) {
        return format(t, "d. M. yyyy HH:mm", { locale: cs });
      }
    } catch {
      return "—";
    }
  }
  return "—";
}

function notePreview(note: string): string | null {
  const t = note.trim();
  if (!t) return null;
  if (t.length <= NOTE_PREVIEW_LEN) return t;
  return `${t.slice(0, NOTE_PREVIEW_LEN)}…`;
}

type Props = {
  companyId: string;
  employeeId: string;
  /** Kotva pro skok z jiné stránky */
  sectionId?: string;
};

export function EmployeeDebtsReadonlySection({
  companyId,
  employeeId,
  sectionId = "employee-debts",
}: Props) {
  const firestore = useFirestore();

  const debtsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "employee_debts"),
      where("employeeId", "==", employeeId),
      limit(FETCH_LIMIT_DEBTS)
    );
  }, [firestore, companyId, employeeId]);

  const paymentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "employee_debt_payments"),
      where("employeeId", "==", employeeId),
      limit(FETCH_LIMIT_PAYMENTS)
    );
  }, [firestore, companyId, employeeId]);

  const historyQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "employee_debt_history"),
      where("employeeId", "==", employeeId),
      limit(FETCH_LIMIT_HISTORY)
    );
  }, [firestore, companyId, employeeId]);

  const { data: debtsRaw = [], isLoading: debtsLoading, error: debtsError } =
    useCollection(debtsQuery, silentListen);
  const {
    data: paymentsRaw = [],
    isLoading: paymentsLoading,
    error: paymentsError,
  } = useCollection(paymentsQuery, silentListen);
  const {
    data: historyRaw = [],
    isLoading: historyLoading,
    error: historyError,
  } = useCollection(historyQuery, silentListen);

  const debts = useMemo((): EmployeeDebtReadRow[] => {
    const raw = Array.isArray(debtsRaw) ? debtsRaw : [];
    return raw
      .map((d: Record<string, unknown>) => ({
        id: String(d?.id ?? ""),
        employeeId: String(d?.employeeId ?? ""),
        amount: Number(d?.amount) || 0,
        originalAmount:
          typeof d?.originalAmount === "number" && Number.isFinite(d.originalAmount)
            ? Number(d.originalAmount)
            : undefined,
        remainingAmount: Number(d?.remainingAmount) || 0,
        date: String(d?.date ?? ""),
        note: d?.note != null ? String(d.note) : "",
        reason: parseDebtReason(d?.reason),
        status: debtStatusFromDoc({
          remainingAmount: Number(d?.remainingAmount) || 0,
          status: d?.status,
        }),
        createdAt: d?.createdAt,
        paidAt: d?.paidAt,
        paidBy: d?.paidBy != null ? String(d.paidBy) : undefined,
        paidByName: d?.paidByName != null ? String(d.paidByName) : undefined,
      }))
      .filter((d) => d.id)
      .sort((a, b) => createdSortMs(b) - createdSortMs(a));
  }, [debtsRaw]);

  const payments = useMemo((): EmployeeDebtPaymentReadRow[] => {
    const raw = Array.isArray(paymentsRaw) ? paymentsRaw : [];
    return raw
      .map((p: Record<string, unknown>) => ({
        id: String(p?.id ?? ""),
        debtId: String(p?.debtId ?? ""),
        employeeId: String(p?.employeeId ?? ""),
        amount: Number(p?.amount) || 0,
        date: String(p?.date ?? ""),
        note: p?.note != null ? String(p.note) : "",
        paidAt: p?.paidAt,
        paidBy: p?.paidBy != null ? String(p.paidBy) : undefined,
        paymentMethod:
          p?.paymentMethod != null && String(p.paymentMethod).trim()
            ? String(p.paymentMethod).trim()
            : undefined,
      }))
      .filter((p) => p.id && p.debtId);
  }, [paymentsRaw]);

  const debtHistory = useMemo((): EmployeeDebtHistoryReadRow[] => {
    const raw = Array.isArray(historyRaw) ? historyRaw : [];
    return raw
      .map((h: Record<string, unknown>) => ({
        id: String(h?.id ?? ""),
        debtId: String(h?.debtId ?? ""),
        employeeId: String(h?.employeeId ?? ""),
        companyId: String(h?.companyId ?? ""),
        originalAmount: Number(h?.originalAmount) || 0,
        debtDate: String(h?.debtDate ?? ""),
        debtNote: h?.debtNote != null ? String(h.debtNote) : "",
        closureNote: h?.closureNote != null ? String(h.closureNote) : "",
        settlementMethod:
          h?.settlementMethod != null && String(h.settlementMethod).trim()
            ? String(h.settlementMethod).trim()
            : null,
        paidAt: h?.paidAt,
        paidBy: String(h?.paidBy ?? ""),
        paidByName: h?.paidByName != null ? String(h.paidByName) : null,
        status: (String(h?.status) === "overpaid" ? "overpaid" : "paid") as "paid" | "overpaid",
      }))
      .filter((h) => h.id && h.debtId)
      .sort((a, b) => {
        const ta = createdSortMs({
          createdAt: a.paidAt,
          date: a.debtDate,
        } as EmployeeDebtReadRow);
        const tb = createdSortMs({
          createdAt: b.paidAt,
          date: b.debtDate,
        } as EmployeeDebtReadRow);
        return tb - ta;
      });
  }, [historyRaw]);

  const paymentsByDebtId = useMemo(() => {
    const m = new Map<string, EmployeeDebtPaymentReadRow[]>();
    for (const p of payments) {
      const list = m.get(p.debtId) ?? [];
      list.push(p);
      m.set(p.debtId, list);
    }
    for (const [, list] of m) {
      list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }
    return m;
  }, [payments]);

  const summary = useMemo(() => {
    let totalAmount = 0;
    let totalRemaining = 0;
    for (const d of debts) {
      totalAmount += d.amount;
      totalRemaining += d.remainingAmount;
    }
    const repaid = Math.max(
      0,
      Math.round((totalAmount - totalRemaining) * 100) / 100
    );
    return {
      totalAmount: Math.round(totalAmount * 100) / 100,
      totalRemaining: Math.round(totalRemaining * 100) / 100,
      repaid,
    };
  }, [debts]);

  const activeDebts = useMemo(
    () => debts.filter((d) => d.status === "active"),
    [debts]
  );
  const settledDebts = useMemo(
    () => debts.filter((d) => d.status === "paid" || d.status === "overpaid"),
    [debts]
  );

  const [detailDebt, setDetailDebt] = useState<EmployeeDebtReadRow | null>(
    null
  );

  const loading = debtsLoading || paymentsLoading || historyLoading;
  const error = debtsError || paymentsError || historyError;

  const statusBadge = (d: EmployeeDebtReadRow) => {
    if (d.status === "overpaid") {
      return (
        <Badge variant="secondary" className="shrink-0">
          Přeplaceno
        </Badge>
      );
    }
    if (d.status === "paid") {
      return (
        <Badge className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-600">
          Splaceno
        </Badge>
      );
    }
    return <Badge variant="destructive">Aktivní</Badge>;
  };

  const detailPayments = detailDebt
    ? paymentsByDebtId.get(detailDebt.id) ?? []
    : [];

  const detailRepaid = detailDebt
    ? Math.max(
        0,
        Math.round((detailDebt.amount - detailDebt.remainingAmount) * 100) /
          100
      )
    : 0;

  return (
    <Card
      id={sectionId}
      className="scroll-mt-4 border-slate-200 bg-white shadow-sm"
    >
      <CardHeader>
        <CardTitle className="text-lg text-black">Dluhy a historie</CardTitle>
        <p className="text-sm text-slate-700">
          Aktivní a doplacené dluhy jsou oddělené. Po úplném doplatění zůstává
          záznam v evidenci a v auditní historii. Úpravy provádí pouze
          administrátor.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="default" className="border-amber-300 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-800" />
            <AlertTitle>Data dluhů se nepodařilo načíst</AlertTitle>
            <AlertDescription>
              Zkuste stránku později obnovit. Souhrnné částky nemusí být k
              dispozici.
            </AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-800">
            <Loader2 className="h-4 w-4 animate-spin" />
            Načítání dluhů…
          </p>
        ) : debts.length === 0 ? (
          <p className="text-sm text-slate-800">
            Nemáte evidované žádné dluhy.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">
                  Celkový dluh (součet jistin)
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums text-black">
                  {formatKc(summary.totalAmount)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">
                  Celkem splaceno
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums text-black">
                  {formatKc(summary.repaid)}
                </p>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50/80 p-3">
                <p className="text-xs font-medium text-rose-900">
                  Celkem zbývá
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums text-rose-950">
                  {formatKc(summary.totalRemaining)}
                </p>
              </div>
            </div>

            <div className="space-y-8">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-black">Aktivní dluhy</h3>
                {activeDebts.length === 0 ? (
                  <p className="text-sm text-slate-700">Nemáte žádný aktivní dluh.</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-3 md:hidden">
                      {activeDebts.map((d) => {
                        const repaid = Math.max(
                          0,
                          Math.round((d.amount - d.remainingAmount) * 100) / 100
                        );
                        const prev = notePreview(d.note);
                        const jistina = d.originalAmount ?? d.amount;
                        return (
                          <li
                            key={d.id}
                            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-black">
                                  {DEBT_REASON_LABEL[d.reason] ?? d.reason}
                                </p>
                                <p className="text-xs text-slate-600">
                                  Datum vzniku: {d.date || "—"}
                                </p>
                              </div>
                              {statusBadge(d)}
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-slate-600">Jistina</span>
                                <p className="font-medium tabular-nums">{formatKc(jistina)}</p>
                              </div>
                              <div>
                                <span className="text-slate-600">Zbývá</span>
                                <p className="font-medium tabular-nums text-rose-800">
                                  {formatKc(d.remainingAmount)}
                                </p>
                              </div>
                              <div className="col-span-2">
                                <span className="text-slate-600">Splaceno</span>
                                <p className="font-medium tabular-nums">{formatKc(repaid)}</p>
                              </div>
                            </div>
                            {prev ? (
                              <p className="mt-2 line-clamp-2 text-xs text-slate-700">
                                <span className="font-medium">Poznámka: </span>
                                {prev}
                              </p>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-3 w-full border-slate-300"
                              onClick={() => setDetailDebt(d)}
                            >
                              Detail
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="hidden overflow-x-auto rounded-md border border-slate-200 md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-black">Důvod</TableHead>
                            <TableHead className="text-black">Datum vzniku</TableHead>
                            <TableHead className="text-right text-black">Jistina</TableHead>
                            <TableHead className="text-right text-black">Splaceno</TableHead>
                            <TableHead className="text-right text-black">Zbývá</TableHead>
                            <TableHead className="text-black">Stav</TableHead>
                            <TableHead className="text-black max-w-[180px]">Poznámka</TableHead>
                            <TableHead className="text-black w-[100px]"> </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeDebts.map((d) => {
                            const repaid = Math.max(
                              0,
                              Math.round((d.amount - d.remainingAmount) * 100) / 100
                            );
                            const prev = notePreview(d.note);
                            const jistina = d.originalAmount ?? d.amount;
                            return (
                              <TableRow key={d.id}>
                                <TableCell className="font-medium text-black">
                                  {DEBT_REASON_LABEL[d.reason] ?? d.reason}
                                </TableCell>
                                <TableCell className="text-black">{d.date || "—"}</TableCell>
                                <TableCell className="text-right font-medium tabular-nums">
                                  {formatKc(jistina)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatKc(repaid)}
                                </TableCell>
                                <TableCell className="text-right font-medium tabular-nums text-rose-800">
                                  {formatKc(d.remainingAmount)}
                                </TableCell>
                                <TableCell>{statusBadge(d)}</TableCell>
                                <TableCell className="max-w-[200px] text-xs text-slate-700">
                                  {prev ?? "—"}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="border-slate-300"
                                    onClick={() => setDetailDebt(d)}
                                  >
                                    Detail
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-3 border-t border-slate-200 pt-6">
                <h3 className="text-sm font-semibold text-black">Doplacené dluhy</h3>
                {settledDebts.length === 0 ? (
                  <p className="text-sm text-slate-700">Zatím žádný uzavřený dluh.</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-3 md:hidden">
                      {settledDebts.map((d) => {
                        const jistina = d.originalAmount ?? d.amount;
                        const prev = notePreview(d.note);
                        return (
                          <li
                            key={d.id}
                            className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-4 shadow-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-black">
                                  {DEBT_REASON_LABEL[d.reason] ?? d.reason}
                                </p>
                                <p className="text-xs text-slate-600">
                                  Vznik: {d.date || "—"} · Doplaceno: {formatTs(d.paidAt)}
                                </p>
                              </div>
                              {statusBadge(d)}
                            </div>
                            <div className="mt-2 text-sm">
                              <span className="text-slate-600">Jistina </span>
                              <span className="font-semibold tabular-nums">{formatKc(jistina)}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-700">
                              Uzavřel: {d.paidByName?.trim() || d.paidBy || "—"}
                            </p>
                            {prev ? (
                              <p className="mt-2 line-clamp-2 text-xs text-slate-700">
                                <span className="font-medium">Poznámka: </span>
                                {prev}
                              </p>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-3 w-full border-slate-300"
                              onClick={() => setDetailDebt(d)}
                            >
                              Detail
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="hidden overflow-x-auto rounded-md border border-slate-200 md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-black">Důvod</TableHead>
                            <TableHead className="text-black">Datum vzniku</TableHead>
                            <TableHead className="text-right text-black">Částka</TableHead>
                            <TableHead className="text-black">Datum doplatění</TableHead>
                            <TableHead className="text-black max-w-[200px]">Poznámka</TableHead>
                            <TableHead className="text-black">Uzavřel</TableHead>
                            <TableHead className="text-black w-[100px]"> </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {settledDebts.map((d) => {
                            const jistina = d.originalAmount ?? d.amount;
                            const prev = notePreview(d.note);
                            return (
                              <TableRow key={d.id}>
                                <TableCell className="font-medium text-black">
                                  {DEBT_REASON_LABEL[d.reason] ?? d.reason}
                                </TableCell>
                                <TableCell className="text-black">{d.date || "—"}</TableCell>
                                <TableCell className="text-right font-medium tabular-nums">
                                  {formatKc(jistina)}
                                </TableCell>
                                <TableCell className="text-sm">{formatTs(d.paidAt)}</TableCell>
                                <TableCell className="max-w-[220px] text-xs text-slate-700">
                                  {prev ?? "—"}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {d.paidByName?.trim() || d.paidBy || "—"}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="border-slate-300"
                                    onClick={() => setDetailDebt(d)}
                                  >
                                    Detail
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </div>

              {debtHistory.length > 0 ? (
                <div className="space-y-2 border-t border-slate-200 pt-6">
                  <h3 className="text-sm font-semibold text-black">
                    Historie uzavření (audit)
                  </h3>
                  <p className="text-xs text-slate-600">
                    Každé úplné doplatění vytvoří trvalý řádek — stejný dluh může
                    mít více záznamů při opětovném otevření a znovu uzavření.
                  </p>
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-black">Jistina</TableHead>
                          <TableHead className="text-black">Vznik dluhu</TableHead>
                          <TableHead className="text-black">Uzavřeno</TableHead>
                          <TableHead className="text-black">Stav</TableHead>
                          <TableHead className="text-black">Způsob</TableHead>
                          <TableHead className="text-black max-w-[200px]">Poznámka ke splátce</TableHead>
                          <TableHead className="text-black">Uzavřel</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {debtHistory.map((h) => (
                          <TableRow key={h.id}>
                            <TableCell className="font-medium tabular-nums">
                              {formatKc(h.originalAmount)}
                            </TableCell>
                            <TableCell className="text-sm">{h.debtDate || "—"}</TableCell>
                            <TableCell className="text-sm">{formatTs(h.paidAt)}</TableCell>
                            <TableCell>
                              {h.status === "overpaid" ? (
                                <Badge variant="secondary">Přeplaceno</Badge>
                              ) : (
                                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                                  Doplaceno
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{h.settlementMethod || "—"}</TableCell>
                            <TableCell className="max-w-[240px] text-xs text-slate-700">
                              {h.closureNote.trim() ? h.closureNote : "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {h.paidByName?.trim() || h.paidBy || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={detailDebt != null} onOpenChange={(o) => !o && setDetailDebt(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-black sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detail dluhu</DialogTitle>
          </DialogHeader>
          {detailDebt ? (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium text-slate-600">Důvod</p>
                <p className="font-semibold text-black">
                  {DEBT_REASON_LABEL[detailDebt.reason] ?? detailDebt.reason}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-600">
                    Datum vzniku
                  </p>
                  <p className="font-medium">{detailDebt.date || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-600">Stav</p>
                  <div className="mt-0.5">{statusBadge(detailDebt)}</div>
                </div>
              </div>
              {detailDebt.status !== "active" ? (
                <div className="grid grid-cols-2 gap-3 rounded-md border border-emerald-100 bg-emerald-50/50 p-3">
                  <div>
                    <p className="text-xs font-medium text-slate-600">Datum doplatění</p>
                    <p className="font-medium">{formatTs(detailDebt.paidAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-600">Uzavřel</p>
                    <p className="font-medium">
                      {detailDebt.paidByName?.trim() || detailDebt.paidBy || "—"}
                    </p>
                  </div>
                </div>
              ) : null}
              <div>
                <p className="text-xs font-medium text-slate-600">
                  Poznámka administrátora
                </p>
                <p className="mt-1 whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 p-2 text-slate-900">
                  {detailDebt.note.trim() ? detailDebt.note : "—"}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <p className="text-xs text-slate-600">Jistina</p>
                  <p className="font-bold tabular-nums">
                    {formatKc(detailDebt.originalAmount ?? detailDebt.amount)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Splaceno</p>
                  <p className="font-bold tabular-nums">
                    {formatKc(detailRepaid)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Zbývá</p>
                  <p className="font-bold tabular-nums text-rose-800">
                    {formatKc(detailDebt.remainingAmount)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Splátky k tomuto dluhu
                </p>
                {detailPayments.length === 0 ? (
                  <p className="mt-2 text-slate-600">Zatím žádné splátky.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detailPayments.map((p) => (
                      <li
                        key={p.id}
                        className="rounded-md border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-semibold tabular-nums text-black">
                            {formatKc(p.amount)}
                          </span>
                          <span className="text-xs text-slate-600">
                            {p.date || "—"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Zaznamenáno: {formatTs(p.paidAt)}
                          {p.paidBy ? ` · ${p.paidBy}` : ""}
                          {p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
                        </p>
                        {p.note.trim() ? (
                          <p className="mt-1 text-xs text-slate-700">{p.note}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
