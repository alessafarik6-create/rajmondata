"use client";

import React, { useCallback, useImperativeHandle, useMemo, useState, forwardRef } from "react";
import { collection, query } from "firebase/firestore";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import { Loader2, FileDown, Pencil, Trash2, ArrowRightCircle } from "lucide-react";
import {
  useCollection,
  useCompany,
  useFirestore,
  useMemoFirebase,
  useUser,
} from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { formatMoneyKc } from "@/lib/job-payment-summary";
import {
  PRELIMINARY_DEAL_STATUSES,
  PRELIMINARY_DEAL_STATUS_LABELS,
  preliminaryDealPriceLabel,
  type PreliminaryDealDoc,
  type PreliminaryDealPriceVatMode,
  type PreliminaryDealStatus,
} from "@/lib/leads/preliminary-deal-types";
import {
  computePreliminaryDealsSummary,
  preliminaryDealMatchesFilters,
} from "@/lib/leads/preliminary-deal-summary";
import { parsePreliminaryDealDoc } from "@/lib/leads/preliminary-deal-server";
import {
  buildEmployeeNameMap,
  resolvePreliminaryDealResponsibleName,
} from "@/lib/leads/preliminary-deal-employees";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";

export type PreliminaryDealFormPrefill = {
  sourceLeadId?: string;
  title?: string;
  description?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  priceAmount?: number;
};

export type PreliminaryDealsPanelHandle = {
  openCreate: (prefill?: PreliminaryDealFormPrefill) => void;
};

type Props = {
  canWrite: boolean;
  employees?: { id: string; name: string }[];
  customers?: { id: string; label: string }[];
};

function parseCreatedAt(raw: unknown): Date | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "object" && raw !== null && "toDate" in raw) {
    try {
      return (raw as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

const emptyForm = (): Record<string, string> => ({
  title: "",
  description: "",
  priceAmount: "",
  priceVatMode: "with_vat",
  customerId: "",
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  expectedCompletionDate: "",
  expectedConfirmationDate: "",
  note: "",
  responsibleEmployeeId: "",
  sourceLeadId: "",
});

export const PreliminaryDealsPanel = forwardRef<PreliminaryDealsPanelHandle, Props>(
  function PreliminaryDealsPanel({ canWrite, employees = [], customers = [] }, ref) {
    const firestore = useFirestore();
    const { companyId } = useCompany();
    const { user } = useUser();
    const { toast } = useToast();
    const jobsAccess = usePortalModuleAccess("jobs");

    const dealsRef = useMemoFirebase(
      () =>
        firestore && companyId
          ? query(collection(firestore, "companies", companyId, "preliminary_deals"))
          : null,
      [firestore, companyId]
    );
    const { data: dealsRaw, isLoading } = useCollection(dealsRef);

    const deals = useMemo(() => {
      const out: (PreliminaryDealDoc & { id: string })[] = [];
      for (const row of dealsRaw ?? []) {
        const id = String((row as { id?: string }).id ?? "");
        const parsed = parsePreliminaryDealDoc(id, row as Record<string, unknown>);
        if (parsed) out.push(parsed);
      }
      out.sort((a, b) => {
        const ta = parseCreatedAt(a.createdAt)?.getTime() ?? 0;
        const tb = parseCreatedAt(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
      return out;
    }, [dealsRaw]);

    const [q, setQ] = useState("");
    const [statusFilter, setStatusFilter] = useState<PreliminaryDealStatus | "all">("all");
    const [employeeFilter, setEmployeeFilter] = useState<string>("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [selected, setSelected] = useState<Record<string, boolean>>({});

    const filtered = useMemo(() => {
      return deals.filter((d) =>
        preliminaryDealMatchesFilters(
          d,
          { q, status: statusFilter, responsibleEmployeeId: employeeFilter, dateFrom, dateTo },
          parseCreatedAt(d.createdAt)
        )
      );
    }, [deals, q, statusFilter, employeeFilter, dateFrom, dateTo]);

    const summary = useMemo(() => computePreliminaryDealsSummary(filtered), [filtered]);

    const employeeNameById = useMemo(() => buildEmployeeNameMap(employees), [employees]);

    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    const [convertDeal, setConvertDeal] = useState<(PreliminaryDealDoc & { id: string }) | null>(
      null
    );
    const [convertTitle, setConvertTitle] = useState("");
    const [convertPrice, setConvertPrice] = useState("");
    const [converting, setConverting] = useState(false);

    const [detailDeal, setDetailDeal] = useState<(PreliminaryDealDoc & { id: string }) | null>(
      null
    );

    const openCreateInternal = useCallback((prefill?: PreliminaryDealFormPrefill) => {
      const f = emptyForm();
      if (prefill) {
        if (prefill.title) f.title = prefill.title;
        if (prefill.description) f.description = prefill.description;
        if (prefill.customerName) f.customerName = prefill.customerName;
        if (prefill.customerPhone) f.customerPhone = prefill.customerPhone;
        if (prefill.customerEmail) f.customerEmail = prefill.customerEmail;
        if (prefill.sourceLeadId) f.sourceLeadId = prefill.sourceLeadId;
        if (prefill.priceAmount != null && Number.isFinite(prefill.priceAmount)) {
          f.priceAmount = String(Math.round(prefill.priceAmount));
        }
      }
      setEditingId(null);
      setForm(f);
      setFormOpen(true);
    }, []);

    useImperativeHandle(ref, () => ({ openCreate: openCreateInternal }), [openCreateInternal]);

    const openEdit = (d: PreliminaryDealDoc & { id: string }) => {
      setEditingId(d.id);
      setForm({
        title: d.title,
        description: d.description,
        priceAmount: String(d.priceAmount ?? ""),
        priceVatMode: d.priceVatMode,
        customerId: d.customerId ?? "",
        customerName: d.customerName ?? "",
        customerPhone: d.customerPhone ?? "",
        customerEmail: d.customerEmail ?? "",
        expectedCompletionDate: d.expectedCompletionDate ?? "",
        expectedConfirmationDate: d.expectedConfirmationDate ?? "",
        note: d.note ?? "",
        responsibleEmployeeId: d.responsibleEmployeeId ?? "",
        sourceLeadId: d.sourceLeadId ?? "",
      });
      setFormOpen(true);
    };

    const saveForm = async () => {
      if (!user || !companyId || !canWrite) return;
      if (!form.title.trim() || !form.description.trim()) {
        toast({ variant: "destructive", title: "Vyplňte název a popis." });
        return;
      }
      const price = Number(form.priceAmount);
      if (!Number.isFinite(price) || price < 0) {
        toast({ variant: "destructive", title: "Zadejte platnou předběžnou cenu." });
        return;
      }
      setSaving(true);
      try {
        const token = await user.getIdToken();
        const payload = {
          companyId,
          title: form.title.trim(),
          description: form.description.trim(),
          priceAmount: price,
          priceVatMode: form.priceVatMode as PreliminaryDealPriceVatMode,
          customerId: form.customerId.trim() || null,
          customerName: form.customerName.trim() || null,
          customerPhone: form.customerPhone.trim() || null,
          customerEmail: form.customerEmail.trim() || null,
          expectedCompletionDate: form.expectedCompletionDate.trim() || null,
          expectedConfirmationDate: form.expectedConfirmationDate.trim() || null,
          note: form.note.trim() || null,
          responsibleEmployeeId: form.responsibleEmployeeId.trim() || null,
          sourceLeadId: form.sourceLeadId.trim() || null,
        };
        const url = editingId
          ? `/api/company/preliminary-deals/${encodeURIComponent(editingId)}`
          : "/api/company/preliminary-deals";
        const res = await fetch(url, {
          method: editingId ? "PATCH" : "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Uložení selhalo.");
        toast({ title: editingId ? "Záznam uložen" : "Předjednaná zakázka vytvořena" });
        setFormOpen(false);
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Uložení selhalo",
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setSaving(false);
      }
    };

    const patchStatus = async (dealId: string, status: PreliminaryDealStatus) => {
      if (!user || !companyId || !canWrite) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/company/preliminary-deals/${encodeURIComponent(dealId)}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ companyId, status }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Změna stavu selhala.");
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Stav se nepodařilo uložit",
          description: e instanceof Error ? e.message : String(e),
        });
      }
    };

    const deleteDeal = async (dealId: string) => {
      if (!user || !companyId || !canWrite) return;
      if (!window.confirm("Smazat tento záznam předjednané zakázky?")) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/company/preliminary-deals/${encodeURIComponent(dealId)}?companyId=${encodeURIComponent(companyId)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
        );
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Smazání selhalo.");
        toast({ title: "Záznam smazán" });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Smazání selhalo",
          description: e instanceof Error ? e.message : String(e),
        });
      }
    };

    const runExport = async (format: "pdf" | "csv" | "xlsx", opts?: { dealId?: string }) => {
      if (!user || !companyId) return;
      try {
        const token = await user.getIdToken();
        const params = new URLSearchParams({ companyId, format });
        if (opts?.dealId) params.set("dealId", opts.dealId);
        else {
          if (q.trim()) params.set("q", q.trim());
          if (statusFilter !== "all") params.set("status", statusFilter);
          if (employeeFilter !== "all") params.set("responsibleEmployeeId", employeeFilter);
          if (dateFrom) params.set("dateFrom", dateFrom);
          if (dateTo) params.set("dateTo", dateTo);
          const ids = Object.entries(selected)
            .filter(([, v]) => v)
            .map(([id]) => id);
          if (ids.length) params.set("ids", ids.join(","));
        }
        const res = await fetch(`/api/company/preliminary-deals/export?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Export selhal.");
        }
        const blob = await res.blob();
        const ext = format === "xlsx" ? "xlsx" : format === "pdf" ? "pdf" : "csv";
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = opts?.dealId ? `predjednana-${opts.dealId}.${ext}` : `predjednane.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Export selhal",
          description: e instanceof Error ? e.message : String(e),
        });
      }
    };

    const runConvert = async () => {
      if (!convertDeal || !user || !companyId) return;
      if (!jobsAccess.canWrite) {
        toast({ variant: "destructive", title: "Nemáte oprávnění vytvářet zakázky." });
        return;
      }
      setConverting(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/company/preliminary-deals/${encodeURIComponent(convertDeal.id)}/convert`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              companyId,
              title: convertTitle.trim() || convertDeal.title,
              priceAmount: convertPrice.trim() ? Number(convertPrice) : convertDeal.priceAmount,
            }),
          }
        );
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          jobId?: string;
          alreadyConverted?: boolean;
        };
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Převod selhal.");
        toast({
          title: data.alreadyConverted ? "Zakázka již existuje" : "Zakázka vytvořena",
          description: data.jobId ? `ID zakázky: ${data.jobId}` : undefined,
        });
        setConvertDeal(null);
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Převod do zakázky selhal",
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setConverting(false);
      }
    };

    if (isLoading) {
      return (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">Počet záznamů</p>
            <p className="text-xl font-semibold tabular-nums">{summary.count}</p>
          </div>
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">Pipeline (Kč)</p>
            <p className="text-xl font-semibold tabular-nums">{formatMoneyKc(summary.pipelineValue)}</p>
          </div>
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">Čeká na potvrzení</p>
            <p className="text-xl font-semibold tabular-nums">
              {formatMoneyKc(summary.waitingConfirmationValue)}
            </p>
          </div>
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">Potvrzeno</p>
            <p className="text-xl font-semibold tabular-nums">{formatMoneyKc(summary.confirmedValue)}</p>
          </div>
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">Převedeno do zakázek</p>
            <p className="text-xl font-semibold tabular-nums">{formatMoneyKc(summary.convertedValue)}</p>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="grid gap-2 md:grid-cols-3">
            <Input
              placeholder="Vyhledat…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className={NATIVE_SELECT_CLASS}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as PreliminaryDealStatus | "all")}
            >
              <option value="all">Všechny stavy</option>
              {PRELIMINARY_DEAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PRELIMINARY_DEAL_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className={NATIVE_SELECT_CLASS}
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
            >
              <option value="all">Všichni zaměstnanci</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="sm:max-w-[11rem]"
              aria-label="Datum od"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="sm:max-w-[11rem]"
              aria-label="Datum do"
            />
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Button type="button" variant="outline" className="min-h-10" onClick={() => void runExport("csv")}>
                <FileDown className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              <Button type="button" variant="outline" className="min-h-10" onClick={() => void runExport("xlsx")}>
                Excel
              </Button>
              <Button type="button" variant="outline" className="min-h-10" onClick={() => void runExport("pdf")}>
                PDF seznam
              </Button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="p-2 w-8" />
                <th className="p-2">Název</th>
                <th className="p-2">Zákazník</th>
                <th className="p-2">Cena</th>
                <th className="p-2">Termín</th>
                <th className="p-2">Stav</th>
                <th className="p-2">Odpovědný</th>
                <th className="p-2">Vytvořeno</th>
                <th className="p-2">Akce</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const created = parseCreatedAt(d.createdAt);
                return (
                  <tr key={d.id} className="border-t">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={!!selected[d.id]}
                        onChange={(e) => setSelected((p) => ({ ...p, [d.id]: e.target.checked }))}
                      />
                    </td>
                    <td className="p-2 font-medium">{d.title}</td>
                    <td className="p-2">{d.customerName || "—"}</td>
                    <td className="p-2 tabular-nums">
                      {preliminaryDealPriceLabel(d.priceAmount, d.priceVatMode)}
                    </td>
                    <td className="p-2">{d.expectedCompletionDate || "—"}</td>
                    <td className="p-2">
                      {canWrite ? (
                        <select
                          className={NATIVE_SELECT_CLASS + " h-8 text-xs"}
                          value={d.status}
                          disabled={d.status === "prevedeno_do_zakazky"}
                          onChange={(e) =>
                            void patchStatus(d.id, e.target.value as PreliminaryDealStatus)
                          }
                        >
                          {PRELIMINARY_DEAL_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {PRELIMINARY_DEAL_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        PRELIMINARY_DEAL_STATUS_LABELS[d.status]
                      )}
                    </td>
                    <td className="p-2">
                      {resolvePreliminaryDealResponsibleName(d, employeeNameById)}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {created ? format(created, "d. M. yyyy", { locale: cs }) : "—"}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setDetailDeal(d)}>
                          Detail
                        </Button>
                        {canWrite ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => openEdit(d)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void runExport("pdf", { dealId: d.id })}
                        >
                          PDF
                        </Button>
                        {canWrite && d.status !== "prevedeno_do_zakazky" ? (
                          <Button
                            type="button"
                            size="sm"
                            className="bg-orange-600 hover:bg-orange-700 text-white"
                            onClick={() => {
                              setConvertDeal(d);
                              setConvertTitle(d.title);
                              setConvertPrice(String(d.priceAmount));
                            }}
                          >
                            <ArrowRightCircle className="h-4 w-4 mr-1" />
                            Převést
                          </Button>
                        ) : null}
                        {canWrite ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => void deleteDeal(d.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Zatím žádné předjednané zakázky.</p>
          ) : null}
        </div>

        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Upravit předjednanou zakázku" : "Nová předjednaná zakázka"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div>
                <Label>Název zakázky *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <Label>Stručný popis práce *</Label>
                <Textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Předběžná cena (Kč) *</Label>
                  <Input
                    inputMode="decimal"
                    value={form.priceAmount}
                    onChange={(e) => setForm({ ...form, priceAmount: e.target.value })}
                  />
                </div>
                <div>
                  <Label>DPH</Label>
                  <Select
                    value={form.priceVatMode}
                    onValueChange={(v) => setForm({ ...form, priceVatMode: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="with_vat">Cena s DPH</SelectItem>
                      <SelectItem value="without_vat">Cena bez DPH</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Zákazník (volitelně ze seznamu)</Label>
                <Select
                  value={form.customerId || "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") {
                      setForm({ ...form, customerId: "" });
                      return;
                    }
                    const c = customers.find((x) => x.id === v);
                    setForm({
                      ...form,
                      customerId: v,
                      customerName: c?.label ?? form.customerName,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte zákazníka" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Ruční zadání —</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Jméno / firma zákazníka"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Telefon"
                  value={form.customerPhone}
                  onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                />
                <Input
                  placeholder="E-mail"
                  value={form.customerEmail}
                  onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Termín realizace</Label>
                  <Input
                    type="date"
                    value={form.expectedCompletionDate}
                    onChange={(e) => setForm({ ...form, expectedCompletionDate: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Datum potvrzení</Label>
                  <Input
                    type="date"
                    value={form.expectedConfirmationDate}
                    onChange={(e) =>
                      setForm({ ...form, expectedConfirmationDate: e.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <Label>Odpovědný zaměstnanec</Label>
                <Select
                  value={form.responsibleEmployeeId || "__none__"}
                  onValueChange={(v) =>
                    setForm({ ...form, responsibleEmployeeId: v === "__none__" ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Poznámka</Label>
                <Textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Zrušit
              </Button>
              <Button
                type="button"
                className="bg-orange-600 hover:bg-orange-700"
                disabled={saving || !canWrite}
                onClick={() => void saveForm()}
              >
                {saving ? "Ukládám…" : "Uložit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={convertDeal != null} onOpenChange={(o) => !o && setConvertDeal(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Převést do zakázky</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Název zakázky</Label>
                <Input value={convertTitle} onChange={(e) => setConvertTitle(e.target.value)} />
              </div>
              <div>
                <Label>Cena (Kč)</Label>
                <Input value={convertPrice} onChange={(e) => setConvertPrice(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConvertDeal(null)}>
                Zrušit
              </Button>
              <Button
                type="button"
                className="bg-orange-600 hover:bg-orange-700"
                disabled={converting}
                onClick={() => void runConvert()}
              >
                {converting ? "Vytvářím…" : "Vytvořit zakázku"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={detailDeal != null} onOpenChange={(o) => !o && setDetailDeal(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{detailDeal?.title}</DialogTitle>
            </DialogHeader>
            {detailDeal ? (
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-medium">Stav:</span>{" "}
                  {PRELIMINARY_DEAL_STATUS_LABELS[detailDeal.status]}
                </p>
                <p>
                  <span className="font-medium">Zákazník:</span> {detailDeal.customerName || "—"}
                </p>
                <p>
                  <span className="font-medium">Cena:</span>{" "}
                  {preliminaryDealPriceLabel(detailDeal.priceAmount, detailDeal.priceVatMode)}
                </p>
                <p>
                  <span className="font-medium">Odpovědná osoba:</span>{" "}
                  {resolvePreliminaryDealResponsibleName(detailDeal, employeeNameById)}
                </p>
                <p className="whitespace-pre-wrap">{detailDeal.description}</p>
                {detailDeal.note ? (
                  <p className="text-muted-foreground whitespace-pre-wrap">{detailDeal.note}</p>
                ) : null}
                {detailDeal.convertedJobId ? (
                  <p className="text-emerald-800">Zakázka: {detailDeal.convertedJobId}</p>
                ) : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDetailDeal(null)}>
                Zavřít
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
);
