"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { cn } from "@/lib/utils";
import { JD } from "@/lib/job-detail-page-styles";
import {
  LIGHT_FORM_CONTROL_CLASS,
  LIGHT_SELECT_CONTENT_CLASS,
  LIGHT_SELECT_TRIGGER_CLASS,
} from "@/lib/light-form-control-classes";
import {
  FileDown,
  FileText,
  LayoutTemplate,
  Plus,
  Receipt,
  Save,
  Trash2,
} from "lucide-react";
import { computeWorkBudgetSummary, sortWorkBudgetItems } from "@/lib/work-budget-calculations";
import { buildWorkBudgetReportPdfHtml } from "@/lib/work-budget-report-pdf";
import {
  billableWorkBudgetItems,
  createInvoiceFromWorkBudgetItems,
} from "@/lib/work-budget-invoice";
import { JobWorkBudgetPdfPreviewDialog } from "@/components/jobs/job-work-budget-pdf-preview-dialog";
import {
  createWorkBudgetTemplate,
  fetchWorkBudgetTemplates,
} from "@/lib/work-budget-templates-firestore";
import type { WorkBudgetTemplateDoc } from "@/lib/work-budget-types";
import {
  computeWorkBudgetLineAmounts,
  newEmptyWorkBudgetItemFields,
  parseJobWorkBudgetItemFromFirestore,
  WORK_BUDGET_ITEMS_COLLECTION,
  workBudgetTemplateContentFromItems,
  type JobWorkBudgetItemDoc,
} from "@/lib/work-budget-types";
import { normalizeVatRate, VAT_RATE_OPTIONS, type VatRatePercent } from "@/lib/vat-calculations";
import type { OrgBankAccountRow } from "@/lib/invoice-billing-meta";
import { logActivitySafe } from "@/lib/activity-log";
import { useRouter } from "next/navigation";

function formatKc(n: number): string {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

function doneAtLabel(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ");
  } catch {
    return iso;
  }
}

type ItemDraft = {
  title: string;
  description: string;
  quantity: string;
  unit: string;
  unitPriceNet: string;
  vatRate: VatRatePercent;
  note: string;
};

function emptyDraft(): ItemDraft {
  return {
    title: "",
    description: "",
    quantity: "1",
    unit: "ks",
    unitPriceNet: "",
    vatRate: 21,
    note: "",
  };
}

function draftFromItem(row: JobWorkBudgetItemDoc): ItemDraft {
  return {
    title: row.title,
    description: row.description,
    quantity: String(row.quantity),
    unit: row.unit,
    unitPriceNet: row.unitPriceNet > 0 ? String(row.unitPriceNet) : "",
    vatRate: row.vatRate,
    note: row.note ?? "",
  };
}

function parseDraft(draft: ItemDraft) {
  const title = draft.title.trim();
  const quantity = Math.max(0, Number(draft.quantity.replace(",", ".")) || 0);
  const unitPriceNet = Math.max(0, Number(draft.unitPriceNet.replace(",", ".")) || 0);
  const vatRate = normalizeVatRate(draft.vatRate);
  const amounts = computeWorkBudgetLineAmounts({ quantity, unitPriceNet, vatRate });
  return {
    title,
    description: draft.description.trim(),
    quantity,
    unit: draft.unit.trim() || "ks",
    unitPriceNet,
    vatRate,
    note: draft.note.trim() || null,
    ...amounts,
  };
}

export function JobWorkBudgetSection(props: {
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  user: User;
  canManage: boolean;
  canMarkDone?: boolean;
  companyDoc?: Record<string, unknown> | null;
  jobNumber?: string | null;
  customerName?: string | null;
  realizationAddress?: string | null;
  customerId?: string | null;
  customer?: unknown;
  orgBankAccounts?: OrgBankAccountRow[];
  profileDisplayName?: string;
  layout?: "jobDetailWide";
}) {
  const {
    companyId,
    jobId,
    jobDisplayName,
    user,
    canManage,
    canMarkDone = canManage,
    companyDoc,
    jobNumber,
    customerName,
    realizationAddress,
    customerId,
    customer,
    orgBankAccounts = [],
    profileDisplayName,
  } = props;

  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();

  const itemsColRef = useMemoFirebase(
    () => collection(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ITEMS_COLLECTION),
    [firestore, companyId, jobId]
  );
  const { data: rawItems = [] } = useCollection<Record<string, unknown>>(itemsColRef);

  const items = useMemo(
    () =>
      sortWorkBudgetItems(
        (rawItems ?? []).map((row, idx) =>
          parseJobWorkBudgetItemFromFirestore(
            row as Record<string, unknown>,
            String((row as { id?: string }).id ?? `row-${idx}`)
          )
        )
      ),
    [rawItems]
  );

  const summary = useMemo(() => computeWorkBudgetSummary(items), [items]);
  const billable = useMemo(() => billableWorkBudgetItems(items), [items]);

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft());
  const [savingItem, setSavingItem] = useState(false);

  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templatePickOpen, setTemplatePickOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templates, setTemplates] = useState<WorkBudgetTemplateDoc[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  const pdfHtml = useMemo(
    () =>
      buildWorkBudgetReportPdfHtml({
        companyDoc,
        jobName: jobDisplayName ?? "Zakázka",
        jobNumber,
        customerName,
        realizationAddress,
        items,
      }),
    [companyDoc, jobDisplayName, jobNumber, customerName, realizationAddress, items]
  );

  const openNewItem = () => {
    setEditingItemId(null);
    setDraft(emptyDraft());
    setItemDialogOpen(true);
  };

  const openEditItem = (row: JobWorkBudgetItemDoc) => {
    if (!canManage || row.invoiced) return;
    setEditingItemId(row.id);
    setDraft(draftFromItem(row));
    setItemDialogOpen(true);
  };

  const saveItem = async () => {
    const parsed = parseDraft(draft);
    if (!parsed.title) {
      toast({ variant: "destructive", title: "Chybí název práce" });
      return;
    }
    if (parsed.quantity <= 0) {
      toast({ variant: "destructive", title: "Zadejte množství větší než 0" });
      return;
    }
    setSavingItem(true);
    try {
      if (editingItemId) {
        await updateDoc(
          doc(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ITEMS_COLLECTION, editingItemId),
          {
            ...parsed,
            updatedAt: serverTimestamp(),
          }
        );
      } else {
        const sortOrder = items.length > 0 ? Math.max(...items.map((r) => r.sortOrder)) + 1 : 0;
        const empty = newEmptyWorkBudgetItemFields();
        await addDoc(collection(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ITEMS_COLLECTION), {
          companyId,
          jobId,
          ...empty,
          sortOrder,
          ...parsed,
          done: false,
          doneAt: null,
          invoiced: false,
          invoicedAt: null,
          linkedInvoiceId: null,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setItemDialogOpen(false);
      toast({ title: editingItemId ? "Položka uložena" : "Položka přidána" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSavingItem(false);
    }
  };

  const deleteItem = async (row: JobWorkBudgetItemDoc) => {
    if (!canManage || row.invoiced) return;
    if (!window.confirm(`Smazat položku „${row.title}"?`)) return;
    try {
      await deleteDoc(
        doc(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ITEMS_COLLECTION, row.id)
      );
      toast({ title: "Položka smazána" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    }
  };

  const toggleDone = async (row: JobWorkBudgetItemDoc, checked: boolean) => {
    if (!canMarkDone || row.invoiced) return;
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ITEMS_COLLECTION, row.id),
        {
          done: checked,
          doneAt: checked ? new Date().toISOString() : null,
          updatedAt: serverTimestamp(),
        }
      );
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Změna stavu se nezdařila",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    }
  };

  const clearBudget = async () => {
    if (!canManage || items.length === 0) return;
    if (!window.confirm("Smazat všechny položky rozpočtu? Tuto akci nelze vrátit.")) return;
    const batch = writeBatch(firestore);
    for (const row of items) {
      if (!row.invoiced) {
        batch.delete(
          doc(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ITEMS_COLLECTION, row.id)
        );
      }
    }
    try {
      await batch.commit();
      toast({ title: "Rozpočet vymazán" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Vymazání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    }
  };

  const openSaveTemplate = () => {
    if (!canManage || items.length === 0) {
      toast({ variant: "destructive", title: "Nejdříve přidejte položky rozpočtu." });
      return;
    }
    setTemplateName("");
    setTemplateDialogOpen(true);
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      toast({ variant: "destructive", title: "Zadejte název šablony." });
      return;
    }
    setTemplateBusy(true);
    try {
      await createWorkBudgetTemplate(firestore, {
        companyId,
        name,
        content: workBudgetTemplateContentFromItems(items),
        createdBy: user.uid,
      });
      setTemplateDialogOpen(false);
      toast({ title: "Šablona uložena", description: name });
      logActivitySafe(firestore, companyId, user, null, {
        actionType: "job.work_budget_template_saved",
        actionLabel: "Šablona rozpočtu uložena",
        entityType: "job",
        entityId: jobId,
        entityName: jobDisplayName,
        details: name,
        sourceModule: "jobs",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení šablony se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setTemplateBusy(false);
    }
  };

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const rows = await fetchWorkBudgetTemplates(firestore, companyId);
      setTemplates(rows);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Načtení šablon se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setTemplatesLoading(false);
    }
  }, [firestore, companyId, toast]);

  const openPickTemplate = async () => {
    if (!canManage) return;
    setTemplatePickOpen(true);
    await loadTemplates();
  };

  const applyTemplate = async (template: WorkBudgetTemplateDoc) => {
    if (!canManage) return;
    setTemplateBusy(true);
    try {
      const baseOrder = items.length > 0 ? Math.max(...items.map((r) => r.sortOrder)) + 1 : 0;
      const batch = writeBatch(firestore);
      template.content.items.forEach((tpl, idx) => {
        const amounts = computeWorkBudgetLineAmounts({
          quantity: tpl.quantity,
          unitPriceNet: tpl.unitPriceNet,
          vatRate: tpl.vatRate,
        });
        const ref = doc(
          collection(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ITEMS_COLLECTION)
        );
        batch.set(ref, {
          companyId,
          jobId,
          sortOrder: baseOrder + idx,
          title: tpl.title,
          description: tpl.description ?? "",
          quantity: tpl.quantity,
          unit: tpl.unit || "ks",
          unitPriceNet: tpl.unitPriceNet,
          vatRate: normalizeVatRate(tpl.vatRate),
          amountNet: amounts.amountNet,
          vatAmount: amounts.vatAmount,
          amountGross: amounts.amountGross,
          done: false,
          doneAt: null,
          note: tpl.note ?? null,
          invoiced: false,
          invoicedAt: null,
          linkedInvoiceId: null,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setTemplatePickOpen(false);
      toast({ title: "Šablona použita", description: template.name });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Použití šablony se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setTemplateBusy(false);
    }
  };

  const openPdfPreview = () => {
    setPreviewHtml(pdfHtml);
    setPreviewOpen(true);
  };

  const exportPdf = async () => {
    setPreviewHtml(pdfHtml);
    setPreviewOpen(true);
    toast({ title: "Náhled PDF", description: "V náhledu použijte tlačítko Stáhnout PDF." });
  };

  const generateInvoice = async () => {
    if (!canManage) return;
    if (!customerId?.trim()) {
      toast({ variant: "destructive", title: "Zakázka nemá přiřazeného zákazníka." });
      return;
    }
    if (billable.length === 0) {
      toast({
        variant: "destructive",
        title: "Žádné položky k fakturaci",
        description: "Označte provedené nevyfakturované položky.",
      });
      return;
    }
    if (!window.confirm(`Vytvořit fakturu z ${billable.length} provedených položek?`)) return;
    setInvoiceBusy(true);
    try {
      const result = await createInvoiceFromWorkBudgetItems({
        firestore,
        companyId,
        jobId,
        jobDisplayName: jobDisplayName ?? "Zakázka",
        customerId: customerId.trim(),
        customer,
        companyDoc,
        orgBankAccounts,
        items,
        userId: user.uid,
        profileDisplayName,
      });
      toast({
        title: "Faktura vytvořena",
        description: `${result.invoiceNumber} · ${formatKc(result.amountGross)}`,
      });
      logActivitySafe(firestore, companyId, user, null, {
        actionType: "job.work_budget_invoice_created",
        actionLabel: "Faktura z rozpočtu prací",
        entityType: "job",
        entityId: jobId,
        entityName: jobDisplayName,
        details: result.invoiceNumber,
        sourceModule: "invoices",
      });
      router.push(`/portal/invoices/${result.invoiceId}`);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fakturace se nezdařila",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setInvoiceBusy(false);
    }
  };

  const draftPreview = useMemo(() => parseDraft(draft), [draft]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="job-work-budget-heading" className={JD.cardTitlePlain}>
            Položkový rozpočet prací
          </h2>
          <p className="text-sm text-gray-700">
            Plánované práce, označení provedení a fakturace hotových položek.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={openNewItem}>
                <Plus className="mr-1.5 h-4 w-4" />
                Nový položkový rozpočet
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={openPickTemplate}>
                <LayoutTemplate className="mr-1.5 h-4 w-4" />
                Vybrat šablonu
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={openSaveTemplate}>
                <Save className="mr-1.5 h-4 w-4" />
                Uložit jako šablonu
              </Button>
            </>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={openPdfPreview}>
            <FileText className="mr-1.5 h-4 w-4" />
            Náhled PDF
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={exportPdf}>
            <FileDown className="mr-1.5 h-4 w-4" />
            Export PDF
          </Button>
          {canManage ? (
            <Button
              type="button"
              size="sm"
              onClick={generateInvoice}
              disabled={invoiceBusy || billable.length === 0}
            >
              <Receipt className="mr-1.5 h-4 w-4" />
              Vygenerovat fakturu z hotových položek
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: "Rozpočet bez DPH", value: summary.totalNet },
          { label: "Rozpočet s DPH", value: summary.totalGross },
          { label: "Provedeno bez DPH", value: summary.doneNet },
          { label: "Provedeno s DPH", value: summary.doneGross },
          { label: "Zbývá bez DPH", value: summary.remainingNet },
          { label: "Zbývá s DPH", value: summary.remainingGross },
        ].map((box) => (
          <div
            key={box.label}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">{box.label}</p>
            <p className="text-lg font-bold tabular-nums text-gray-950">{formatKc(box.value)}</p>
          </div>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-gray-700">
          Zatím žádné položky. {canManage ? "Přidejte položku nebo použijte šablonu." : ""}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Název</th>
                <th className="px-3 py-2 text-right">Množství</th>
                <th className="px-3 py-2 text-left">Jedn.</th>
                <th className="px-3 py-2 text-right">Cena/j. bez DPH</th>
                <th className="px-3 py-2 text-right">DPH</th>
                <th className="px-3 py-2 text-right">Celkem bez DPH</th>
                <th className="px-3 py-2 text-right">DPH</th>
                <th className="px-3 py-2 text-right">Celkem s DPH</th>
                <th className="px-3 py-2 text-center">Provedeno</th>
                <th className="px-3 py-2 text-left">Datum</th>
                {canManage ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-t border-slate-100",
                    row.done && "bg-emerald-50/70",
                    row.invoiced && "opacity-80"
                  )}
                >
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      className={cn(
                        "text-left font-medium text-gray-950",
                        canManage && !row.invoiced && "hover:underline"
                      )}
                      onClick={() => openEditItem(row)}
                      disabled={!canManage || row.invoiced}
                    >
                      {row.title || "—"}
                    </button>
                    {row.description ? (
                      <p className="mt-0.5 text-xs text-gray-600">{row.description}</p>
                    ) : null}
                    {row.note ? (
                      <p className="mt-0.5 text-xs italic text-gray-500">Pozn.: {row.note}</p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.done ? <Badge variant="secondary">Provedeno</Badge> : null}
                      {row.invoiced ? <Badge>Vyfakturováno</Badge> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.quantity}</td>
                  <td className="px-3 py-2">{row.unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKc(row.unitPriceNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.vatRate} %</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKc(row.amountNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKc(row.vatAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {formatKc(row.amountGross)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Checkbox
                      checked={row.done}
                      disabled={!canMarkDone || row.invoiced}
                      onCheckedChange={(v) => void toggleDone(row, v === true)}
                      aria-label={`Provedeno: ${row.title}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                    {doneAtLabel(row.doneAt)}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2">
                      {!row.invoiced ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-red-600"
                          onClick={() => void deleteItem(row)}
                          aria-label="Smazat položku"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && items.length > 0 ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" className="text-red-700" onClick={() => void clearBudget()}>
            Vymazat nevyfakturované položky
          </Button>
        </div>
      ) : null}

      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-w-lg bg-white text-slate-900">
          <DialogHeader>
            <DialogTitle>{editingItemId ? "Upravit položku" : "Nová položka rozpočtu"}</DialogTitle>
            <DialogDescription>Ceny zadávejte bez DPH. DPH se dopočítá automaticky.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Název práce</Label>
              <Input
                className={LIGHT_FORM_CONTROL_CLASS}
                value={draft.title}
                onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div>
              <Label>Popis</Label>
              <Textarea
                className={LIGHT_FORM_CONTROL_CLASS}
                value={draft.description}
                onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Množství</Label>
                <Input
                  className={LIGHT_FORM_CONTROL_CLASS}
                  value={draft.quantity}
                  onChange={(e) => setDraft((p) => ({ ...p, quantity: e.target.value }))}
                />
              </div>
              <div>
                <Label>Jednotka</Label>
                <Input
                  className={LIGHT_FORM_CONTROL_CLASS}
                  value={draft.unit}
                  onChange={(e) => setDraft((p) => ({ ...p, unit: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cena za jednotku bez DPH</Label>
                <Input
                  className={LIGHT_FORM_CONTROL_CLASS}
                  value={draft.unitPriceNet}
                  onChange={(e) => setDraft((p) => ({ ...p, unitPriceNet: e.target.value }))}
                />
              </div>
              <div>
                <Label>Sazba DPH</Label>
                <Select
                  value={String(draft.vatRate)}
                  onValueChange={(v) =>
                    setDraft((p) => ({ ...p, vatRate: normalizeVatRate(Number(v)) }))
                  }
                >
                  <SelectTrigger className={LIGHT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={LIGHT_SELECT_CONTENT_CLASS}>
                    {VAT_RATE_OPTIONS.map((rate) => (
                      <SelectItem key={rate} value={String(rate)}>
                        {rate} %
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Poznámka</Label>
              <Textarea
                className={LIGHT_FORM_CONTROL_CLASS}
                value={draft.note}
                onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))}
              />
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p>
                Celkem bez DPH: <strong>{formatKc(draftPreview.amountNet)}</strong>
              </p>
              <p>
                DPH: <strong>{formatKc(draftPreview.vatAmount)}</strong> · Celkem s DPH:{" "}
                <strong>{formatKc(draftPreview.amountGross)}</strong>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setItemDialogOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" onClick={() => void saveItem()} disabled={savingItem}>
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="bg-white text-slate-900">
          <DialogHeader>
            <DialogTitle>Uložit jako šablonu</DialogTitle>
            <DialogDescription>
              Šablona uloží pouze položky a ceny — bez zákazníka a stavu provedení.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Název šablony</Label>
            <Input
              className={LIGHT_FORM_CONTROL_CLASS}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" onClick={() => void saveTemplate()} disabled={templateBusy}>
              Uložit šablonu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templatePickOpen} onOpenChange={setTemplatePickOpen}>
        <DialogContent className="bg-white text-slate-900 max-w-md">
          <DialogHeader>
            <DialogTitle>Vybrat šablonu</DialogTitle>
            <DialogDescription>Položky ze šablony se přidají do rozpočtu zakázky.</DialogDescription>
          </DialogHeader>
          {templatesLoading ? (
            <p className="text-sm text-gray-600">Načítání…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-gray-600">Žádné šablony. Uložte rozpočet jako šablonu.</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {templates.map((tpl) => (
                <li key={tpl.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                    onClick={() => void applyTemplate(tpl)}
                    disabled={templateBusy}
                  >
                    <span className="font-medium">{tpl.name}</span>
                    <span className="text-xs text-gray-500">{tpl.content.items.length} položek</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <JobWorkBudgetPdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        html={previewHtml}
        title="Položkový rozpočet prací"
        user={user}
        companyId={companyId}
        jobId={jobId}
        pdfFilename={`rozpočet-praci-${jobId}.pdf`}
      />
    </div>
  );
}
