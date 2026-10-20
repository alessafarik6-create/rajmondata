"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, FileDown, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { formatBankMoney } from "@/components/bank/bank-utils";
import { BANK_EXPENSE_CATEGORY_OPTIONS, BANK_MARKETING_SUBCATEGORY_OPTIONS } from "@/lib/bank/expense-categories";
import { downloadCsvFromRows } from "@/lib/csv-download";
import type { BankExpenseCategory, BankMarketingSubcategory } from "@/lib/bank/types";

type TxRow = {
  id: string;
  bookingDate: string;
  counterpartyName: string | null;
  message: string | null;
  amount: number;
  currency: string;
  effectiveCategory: string;
  effectiveCategoryLabel: string;
  marketingSubcategoryLabel: string;
  effectiveMarketingSubcategory?: BankMarketingSubcategory | null;
  needsReview: boolean;
  suggestionReason: string;
  linkedDocumentId?: string | null;
};

type Overview = {
  summary: {
    totalOutgoing: number;
    totalMarketing: number;
    googleAds: number;
    metaAds: number;
    otherMarketing: number;
    payroll: number;
    material: number;
    energy: number;
    insurance: number;
    operations: number;
    other: number;
    netExpenses: number;
    needsReviewCount: number;
  };
  shares: Record<string, number>;
  monthly: { month: string; marketing: number; google: number; meta: number; total: number }[];
  transactions: TxRow[];
};

const PERIOD_OPTIONS = [
  { id: "today", label: "Dnes" },
  { id: "week", label: "Tento týden" },
  { id: "month", label: "Tento měsíc" },
  { id: "prev_month", label: "Minulý měsíc" },
  { id: "year", label: "Tento rok" },
  { id: "custom", label: "Vlastní období" },
];

export function BankExpenseAnalyticsPanel({
  companyId,
  canWrite,
  getAuthHeaders,
  accounts,
  onOpenTransaction,
}: {
  companyId: string;
  canWrite: boolean;
  getAuthHeaders: () => Promise<Record<string, string>>;
  accounts: { id: string; name: string | null }[];
  onOpenTransaction: (id: string) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Overview | null>(null);
  const [datePreset, setDatePreset] = useState("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [marketingChannel, setMarketingChannel] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [q, setQ] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [drillMarketing, setDrillMarketing] = useState<"" | "google_ads" | "meta_ads" | "all_marketing">("");
  const [editTx, setEditTx] = useState<TxRow | null>(null);
  const [editCategory, setEditCategory] = useState<BankExpenseCategory>("other");
  const [editMarketing, setEditMarketing] = useState<BankMarketingSubcategory | "">("");
  const [createRule, setCreateRule] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const qs = new URLSearchParams({ companyId });
      if (datePreset && datePreset !== "custom") qs.set("datePreset", datePreset);
      if (datePreset === "custom") {
        if (dateFrom) qs.set("dateFrom", dateFrom);
        if (dateTo) qs.set("dateTo", dateTo);
      }
      if (accountId) qs.set("accountId", accountId);
      if (marketingChannel) qs.set("marketingChannel", marketingChannel);
      if (expenseCategory) qs.set("expenseCategory", expenseCategory);
      if (needsReviewOnly) qs.set("needsReviewOnly", "1");
      if (q.trim()) qs.set("q", q.trim());
      if (amountMin) qs.set("amountMin", amountMin);
      if (amountMax) qs.set("amountMax", amountMax);
      if (drillMarketing) qs.set("marketingChannel", drillMarketing);

      const res = await fetch(`/api/company/bank/expense-analytics/overview?${qs}`, { headers });
      const json = (await res.json()) as Overview & { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "Načtení selhalo");
      setData(json);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Analýza výdajů",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setLoading(false);
    }
  }, [
    companyId,
    getAuthHeaders,
    datePreset,
    dateFrom,
    dateTo,
    accountId,
    marketingChannel,
    expenseCategory,
    needsReviewOnly,
    q,
    amountMin,
    amountMax,
    drillMarketing,
    toast,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = useMemo(
    () =>
      (data?.monthly ?? []).map((m) => ({
        name: m.month,
        Google: m.google,
        Meta: m.meta,
        Marketing: m.marketing,
      })),
    [data?.monthly]
  );

  const daysInPeriod = useMemo(() => {
    if (datePreset === "today") return 1;
    if (datePreset === "week") return 7;
    if (datePreset === "month") return new Date().getDate();
    if (datePreset === "prev_month") return 30;
    if (datePreset === "year") {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 1);
      return Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000));
    }
    return 30;
  }, [datePreset]);

  const avgDailyMarketing = data
    ? Math.round((data.summary.totalMarketing / daysInPeriod) * 100) / 100
    : 0;

  async function exportPdf() {
    const headers = { ...(await getAuthHeaders()), "Content-Type": "application/json" };
    const res = await fetch("/api/company/bank/expense-analytics/export/pdf", {
      method: "POST",
      headers,
      body: JSON.stringify({
        companyId,
        datePreset: datePreset !== "custom" ? datePreset : undefined,
        dateFrom: datePreset === "custom" ? dateFrom : undefined,
        dateTo: datePreset === "custom" ? dateTo : undefined,
        periodLabel: PERIOD_OPTIONS.find((p) => p.id === datePreset)?.label ?? "Období",
      }),
    });
    if (!res.ok) {
      toast({ variant: "destructive", title: "PDF", description: "Export selhal." });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "analyza-vydaju.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    if (!data?.transactions.length) return;
    downloadCsvFromRows(
      [
        ["Datum", "Dodavatel", "Popis", "Částka", "Měna", "Kategorie", "Marketing", "Kontrola"],
        ...data.transactions.map((t) => [
          t.bookingDate,
          t.counterpartyName ?? "",
          t.message ?? "",
          String(Math.abs(t.amount)),
          t.currency,
          t.effectiveCategoryLabel,
          t.marketingSubcategoryLabel,
          t.needsReview ? "Ano" : "Ne",
        ]),
      ],
      "analyza-vydaju.csv"
    );
  }

  async function saveCategory() {
    if (!editTx || !canWrite) return;
    setSaving(true);
    try {
      const headers = { ...(await getAuthHeaders()), "Content-Type": "application/json" };
      const res = await fetch(`/api/company/bank/transactions/${editTx.id}/classify`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          companyId,
          classification: "expense",
          expenseCategory: editCategory,
          marketingSubcategory: editCategory === "marketing" && editMarketing ? editMarketing : null,
          createVendorRule: createRule,
          ruleMatchValue: createRule ? String(editTx.counterpartyName ?? "").trim() : null,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast({ title: "Kategorie uložena" });
      setEditTx(null);
      await load();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Kolik nás stojí reklama?</h2>
        <p className="text-sm text-slate-600 mt-1">
          Automatická analýza odchozích plateb z napojených bankovních účtů (bez změny bankovních dat).
        </p>
      </div>

      <Card className="border-slate-200 bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filtry
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs">Období</Label>
            <Select value={datePreset} onValueChange={setDatePreset}>
              <SelectTrigger className="bg-white h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {datePreset === "custom" ? (
            <>
              <div>
                <Label className="text-xs">Od</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-white h-9" />
              </div>
              <div>
                <Label className="text-xs">Do</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-white h-9" />
              </div>
            </>
          ) : null}
          <div>
            <Label className="text-xs">Účet</Label>
            <Select value={accountId || "__all"} onValueChange={(v) => setAccountId(v === "__all" ? "" : v)}>
              <SelectTrigger className="bg-white h-9">
                <SelectValue placeholder="Všechny" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Všechny účty</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name ?? a.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Hledat</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} className="bg-white h-9" placeholder="Protistrana, popis…" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="button" className="bg-orange-500 hover:bg-orange-600 text-black h-9" onClick={() => void load()}>
              Použít filtry
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm col-span-full">
            <Checkbox checked={needsReviewOnly} onCheckedChange={(v) => setNeedsReviewOnly(v === true)} />
            Pouze „Vyžaduje kontrolu“
          </label>
        </CardContent>
      </Card>

      {s ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Celkový marketing", value: s.totalMarketing, onClick: () => setDrillMarketing("all_marketing") },
              { label: "Google Ads", value: s.googleAds, onClick: () => setDrillMarketing("google_ads") },
              { label: "Facebook / Meta", value: s.metaAds, onClick: () => setDrillMarketing("meta_ads") },
              { label: "Ostatní reklama", value: s.otherMarketing, onClick: () => setDrillMarketing("") },
            ].map((k) => (
              <Card
                key={k.label}
                className="border-slate-200 bg-white cursor-pointer hover:border-orange-300"
                onClick={() => {
                  k.onClick();
                  void load();
                }}
              >
                <CardContent className="pt-4">
                  <p className="text-xs text-slate-500">{k.label}</p>
                  <p className="text-xl font-semibold tabular-nums">{formatBankMoney(k.value, "CZK")}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="text-sm text-slate-600">
            Průměrné denní marketingové náklady:{" "}
            <strong>{formatBankMoney(avgDailyMarketing, "CZK")}</strong>
            {s.needsReviewCount > 0 ? (
              <span className="text-orange-700 ml-2">· {s.needsReviewCount} plateb vyžaduje kontrolu</span>
            ) : null}
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="text-base">Měsíční výdaje (marketing)</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => `${v.toLocaleString("cs-CZ")} Kč`} />
                    <Legend />
                    <Bar dataKey="Google" fill="#4285F4" />
                    <Bar dataKey="Meta" fill="#1877F2" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="text-base">Rozdělení výdajů</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {[
                  ["Odchozí celkem", s.totalOutgoing, 100],
                  ["Marketing", s.totalMarketing, data?.shares.marketing],
                  ["Mzdy", s.payroll, data?.shares.payroll],
                  ["Materiál", s.material, data?.shares.material],
                  ["Energie", s.energy, data?.shares.energy],
                  ["Pojištění", s.insurance, data?.shares.insurance],
                  ["Provoz", s.operations, data?.shares.operations],
                  ["Ostatní", s.other, data?.shares.other],
                ].map(([label, amount, share]) => (
                  <div key={String(label)} className="flex justify-between gap-2 border-b border-slate-100 py-1">
                    <span>{label}</span>
                    <span className="tabular-nums font-medium">
                      {formatBankMoney(Number(amount), "CZK")}{" "}
                      <span className="text-slate-500 text-xs">({Number(share ?? 0).toFixed(1)} %)</span>
                    </span>
                  </div>
                ))}
                <p className="text-xs text-slate-500 pt-2">Čisté výdaje: {formatBankMoney(s.netExpenses, "CZK")}</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void exportPdf()}>
              <FileDown className="h-4 w-4 mr-1" /> Export PDF
            </Button>
            <Button type="button" variant="outline" onClick={exportCsv}>
              Export CSV
            </Button>
          </div>

          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-base">Platby</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Dodavatel</TableHead>
                    <TableHead>Popis</TableHead>
                    <TableHead className="text-right">Částka</TableHead>
                    <TableHead>Kategorie</TableHead>
                    <TableHead>Doklad</TableHead>
                    <TableHead className="w-[120px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.transactions ?? []).map((t) => (
                    <TableRow
                      key={t.id}
                      className={t.needsReview ? "bg-orange-50/60" : undefined}
                    >
                      <TableCell>{t.bookingDate}</TableCell>
                      <TableCell>{t.counterpartyName ?? "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{t.message ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBankMoney(Math.abs(t.amount), t.currency)}
                      </TableCell>
                      <TableCell>
                        {t.effectiveCategoryLabel}
                        {t.marketingSubcategoryLabel !== "—" ? ` / ${t.marketingSubcategoryLabel}` : ""}
                        {t.needsReview ? (
                          <span className="block text-xs text-orange-700">Vyžaduje kontrolu</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {t.linkedDocumentId ? (
                          <span className="text-xs text-emerald-700">Spárováno</span>
                        ) : (
                          <span className="text-xs text-amber-700">Chybí doklad</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => onOpenTransaction(t.id)}>
                            Detail
                          </Button>
                          {canWrite ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8"
                              onClick={() => {
                                setEditTx(t);
                                setEditCategory((t.effectiveCategory as BankExpenseCategory) || "other");
                                setEditMarketing(t.effectiveMarketingSubcategory ?? "");
                              }}
                            >
                              Kategorie
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      <Dialog open={!!editTx} onOpenChange={(o) => !o && setEditTx(null)}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Změnit kategorii</DialogTitle>
          </DialogHeader>
          {editTx ? (
            <div className="space-y-3 text-sm">
              <p>{editTx.counterpartyName}</p>
              <Select value={editCategory} onValueChange={(v) => setEditCategory(v as BankExpenseCategory)}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BANK_EXPENSE_CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editCategory === "marketing" ? (
                <Select value={editMarketing || "__none"} onValueChange={(v) => setEditMarketing(v === "__none" ? "" : (v as BankMarketingSubcategory))}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Kanál" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {BANK_MARKETING_SUBCATEGORY_OPTIONS.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <label className="flex items-center gap-2">
                <Checkbox checked={createRule} onCheckedChange={(v) => setCreateRule(v === true)} />
                Budoucí platby od tohoto dodavatele zařazovat stejně
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTx(null)}>
              Zrušit
            </Button>
            <Button
              type="button"
              className="bg-orange-500 hover:bg-orange-600 text-black"
              disabled={!canWrite || saving}
              onClick={() => void saveCategory()}
            >
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
