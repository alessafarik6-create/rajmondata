"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
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
import { Switch } from "@/components/ui/switch";
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
  assessWorkBudgetInvoiceRegeneration,
  createInvoiceFromWorkBudgetItems,
  isWorkBudgetInvoiceStale,
  isWorkBudgetSourceInvoice,
  regenerateInvoiceFromWorkBudgetItems,
} from "@/lib/work-budget-invoice";
import {
  computeWorkBudgetInvoicingSummary,
  primaryInvoiceLinkId,
  workBudgetItemHasBillableRemainder,
  workBudgetItemInvoicingStatus,
} from "@/lib/work-budget-invoicing";
import type { WorkBudgetInvoiceDialogConfirm } from "@/components/jobs/job-work-budget-invoice-dialog";
import { JobWorkBudgetPdfPreviewDialog } from "@/components/jobs/job-work-budget-pdf-preview-dialog";
import { JobWorkBudgetRegenerateDialog } from "@/components/jobs/job-work-budget-regenerate-dialog";
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
import {
  normalizeVatRate,
  VAT_RATE_OPTIONS,
  type JobBudgetBreakdown,
  type VatRatePercent,
} from "@/lib/vat-calculations";
import { computeWorkBudgetFinancialOverview } from "@/lib/work-budget-financial-overview";
import {
  EXTRA_WORK_STATUSES,
  isApprovedExtraWorkItem,
  isExtraWorkItem,
  WORK_BUDGET_ITEM_TYPES,
  type ExtraWorkStatus,
  type WorkBudgetItemType,
} from "@/lib/work-budget-types";
import { JobWorkBudgetAdvancesPanel } from "@/components/jobs/job-work-budget-advances-panel";
import { JobWorkBudgetInvoiceDialog } from "@/components/jobs/job-work-budget-invoice-dialog";
import {
  parseWorkBudgetAdvanceFromFirestore,
  WORK_BUDGET_ADVANCES_COLLECTION,
} from "@/lib/work-budget-advances";
import type { OrgBankAccountRow } from "@/lib/invoice-billing-meta";
import { logActivitySafe } from "@/lib/activity-log";
import { useRouter } from "next/navigation";
import { query, where, limit } from "firebase/firestore";
import { RefreshCw } from "lucide-react";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";

function formatKc(n: number): string {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

function isWorkBudgetRowFullyInvoiced(row: JobWorkBudgetItemDoc): boolean {
  return workBudgetItemInvoicingStatus(row) === "full";
}

function WorkBudgetInvoicingBadge({ row }: { row: JobWorkBudgetItemDoc }) {
  const status = workBudgetItemInvoicingStatus(row);
  if (status === "none") return null;
  const invoiceId = primaryInvoiceLinkId(row);
  const label =
    status === "partial" ? "Částečně vyfakturováno" : "Vyfakturováno";
  if (invoiceId) {
    return (
      <Badge variant="secondary" className="font-normal">
        <Link href={`/portal/invoices/${invoiceId}`} className="hover:underline">
          {label}
        </Link>
      </Badge>
    );
  }
  return <Badge variant="secondary">{label}</Badge>;
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
  isExtraWork: boolean;
  extraWorkStatus: ExtraWorkStatus;
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
    isExtraWork: false,
    extraWorkStatus: EXTRA_WORK_STATUSES.DRAFT,
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
    isExtraWork: isExtraWorkItem(row),
    extraWorkStatus: row.extraWorkStatus,
  };
}

function parseDraft(draft: ItemDraft) {
  const title = draft.title.trim();
  const quantity = Math.max(0, Number(draft.quantity.replace(",", ".")) || 0);
  const unitPriceNet = Math.max(0, Number(draft.unitPriceNet.replace(",", ".")) || 0);
    const vatRate = normalizeVatRate(draft.vatRate);
  const amounts = computeWorkBudgetLineAmounts({ quantity, unitPriceNet, vatRate });
  const itemType: WorkBudgetItemType = draft.isExtraWork
    ? WORK_BUDGET_ITEM_TYPES.EXTRA_WORK
    : WORK_BUDGET_ITEM_TYPES.NORMAL;
  const extraWorkStatus: ExtraWorkStatus = draft.isExtraWork
    ? draft.extraWorkStatus
    : EXTRA_WORK_STATUSES.DRAFT;
  return {
    title,
    description: draft.description.trim(),
    quantity,
    unit: draft.unit.trim() || "ks",
    unitPriceNet,
    vatRate,
    note: draft.note.trim() || null,
    itemType,
    extraWorkStatus,
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
  jobBudgetBreakdown?: JobBudgetBreakdown | null;
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
    jobBudgetBreakdown = null,
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

  const advancesColRef = useMemoFirebase(
    () =>
      collection(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ADVANCES_COLLECTION),
    [firestore, companyId, jobId]
  );
  const { data: rawAdvances = [] } = useCollection<Record<string, unknown>>(advancesColRef);
  const advances = useMemo(
    () =>
      (rawAdvances ?? []).map((row, idx) =>
        parseWorkBudgetAdvanceFromFirestore(
          row as Record<string, unknown>,
          String((row as { id?: string }).id ?? `adv-${idx}`)
        )
      ),
    [rawAdvances]
  );

  const financialOverview = useMemo(
    () => computeWorkBudgetFinancialOverview({ items, jobBudget: jobBudgetBreakdown }),
    [items, jobBudgetBreakdown]
  );
  const summary = useMemo(
    () => computeWorkBudgetSummary(items, jobBudgetBreakdown),
    [items, jobBudgetBreakdown]
  );
  const billable = useMemo(
    () => items.filter((row) => workBudgetItemHasBillableRemainder(row, null)),
    [items]
  );
  const invoicingSummary = useMemo(
    () => computeWorkBudgetInvoicingSummary(items),
    [items]
  );

  const jobInvoicesQuery = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? query(
            collection(firestore, "companies", companyId, "invoices"),
            where("jobId", "==", jobId),
            limit(40)
          )
        : null,
    [firestore, companyId, jobId]
  );
  const { data: jobInvoicesRaw = [] } = useCollection<Record<string, unknown>>(jobInvoicesQuery);
  const workBudgetInvoices = useMemo(() => {
    return (jobInvoicesRaw ?? [])
      .filter((row) => isActiveFirestoreDoc(row as { isDeleted?: unknown }))
      .filter((row) => isWorkBudgetSourceInvoice(row as Record<string, unknown>))
      .map((row) => row as Record<string, unknown> & { id: string });
  }, [jobInvoicesRaw]);
  const singleWorkBudgetInvoice =
    workBudgetInvoices.length === 1 ? workBudgetInvoices[0]! : null;

  type RowFilter = "all" | "normal" | "extra_work";
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const filteredItems = useMemo(() => {
    if (rowFilter === "normal") return items.filter((r) => !isExtraWorkItem(r));
    if (rowFilter === "extra_work") return items.filter(isExtraWorkItem);
    return items;
  }, [items, rowFilter]);

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
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [regenerateTarget, setRegenerateTarget] = useState<
    (Record<string, unknown> & { id: string }) | null
  >(null);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);

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
    if (!canManage || isWorkBudgetRowFullyInvoiced(row)) return;
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
    if (!canManage || workBudgetItemInvoicingStatus(row) !== "none") return;
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
    if (!canMarkDone || workBudgetItemInvoicingStatus(row) !== "none") return;
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
      if (workBudgetItemInvoicingStatus(row) === "none") {
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

  const openInvoiceDialog = () => {
    if (!canManage) return;
    if (!customerId?.trim()) {
      toast({ variant: "destructive", title: "Zakázka nemá přiřazeného zákazníka." });
      return;
    }
    if (billable.length === 0) {
      toast({
        variant: "destructive",
        title: "Žádné položky k fakturaci",
        description: "Označte provedené nevyfakturované položky (schválené vícepráce).",
      });
      return;
    }
    setInvoiceDialogOpen(true);
  };

  const generateInvoice = async (payload: WorkBudgetInvoiceDialogConfirm) => {
    if (!canManage) return;
    setInvoiceBusy(true);
    try {
      const result = await createInvoiceFromWorkBudgetItems({
        firestore,
        companyId,
        jobId,
        jobDisplayName: jobDisplayName ?? "Zakázka",
        customerId: customerId!.trim(),
        customer,
        companyDoc,
        orgBankAccounts,
        items,
        advances,
        selectedAdvanceIds: payload.selectedAdvanceIds,
        billingScope: payload.billingScope,
        selectedItemIds: payload.selectedItemIds,
        userId: user.uid,
        profileDisplayName,
      });
      toast({
        title: "Faktura vytvořena",
        description: `${result.invoiceNumber} · ${formatKc(result.amountGross)}`,
      });
      logActivitySafe(firestore, companyId, user, null, {
        actionType: "INVOICE_CREATED",
        actionLabel: "Faktura z rozpočtu prací",
        entityType: "invoice",
        entityId: result.invoiceId,
        entityName: result.invoiceNumber,
        sourceModule: "invoices",
        route: `/portal/invoices/${result.invoiceId}`,
        metadata: {
          organizationId: companyId,
          invoiceId: result.invoiceId,
          jobId,
          billingScope: payload.billingScope,
        },
      });
      setInvoiceDialogOpen(false);
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

  const openRegenerateDialog = (inv: Record<string, unknown> & { id: string }) => {
    const assessment = assessWorkBudgetInvoiceRegeneration(inv);
    if (!assessment.allowed) {
      toast({
        variant: "destructive",
        title: "Nelze přegenerovat",
        description: assessment.blockedReason,
      });
      return;
    }
    setRegenerateTarget(inv);
    setRegenerateDialogOpen(true);
  };

  const regenerateInvoice = async (selectedAdvanceIds: string[]) => {
    if (!canManage || !regenerateTarget || !customerId?.trim()) return;
    if (
      !window.confirm(
        "Faktura bude znovu vytvořena podle aktuálního položkového rozpočtu zakázky. Ruční změny v položkách faktury mohou být přepsány. Pokračovat?"
      )
    ) {
      return;
    }
    setInvoiceBusy(true);
    try {
      const result = await regenerateInvoiceFromWorkBudgetItems({
        firestore,
        companyId,
        jobId,
        invoiceId: regenerateTarget.id,
        jobDisplayName: jobDisplayName ?? "Zakázka",
        customerId: customerId.trim(),
        customer,
        companyDoc,
        orgBankAccounts,
        items,
        advances,
        selectedAdvanceIds,
        userId: user.uid,
        profileDisplayName,
      });
      toast({
        title: "Faktura aktualizována",
        description: `${result.invoiceNumber} · ${formatKc(result.amountGross)}`,
      });
      setRegenerateDialogOpen(false);
      setRegenerateTarget(null);
      router.push(`/portal/invoices/${result.invoiceId}`);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Přegenerování se nezdařilo",
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
        <div className="flex flex-wrap gap-2 max-md:grid max-md:w-full max-md:grid-cols-1 max-md:gap-2 max-md:[&>button]:w-full max-md:[&>button]:min-h-10 sm:flex sm:flex-wrap">
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
            <>
              <Button
                type="button"
                size="sm"
                onClick={openInvoiceDialog}
                disabled={invoiceBusy || billable.length === 0}
              >
                <Receipt className="mr-1.5 h-4 w-4" />
                Vytvořit fakturu
              </Button>
              {singleWorkBudgetInvoice ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={invoiceBusy}
                  onClick={() => openRegenerateDialog(singleWorkBudgetInvoice)}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  Přegenerovat existující fakturu
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <JobWorkBudgetAdvancesPanel companyId={companyId} jobId={jobId} user={user} canManage={canManage} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[
          { label: "Původní rozpočet bez DPH", value: financialOverview.contractBase.net },
          { label: "Vícepráce (schváleno) bez DPH", value: financialOverview.extraWorkApproved.net },
          { label: "Aktuální cena bez DPH", value: financialOverview.currentPrice.net },
          { label: "Aktuální cena s DPH", value: financialOverview.currentPrice.gross },
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

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-gray-900">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Fakturace</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div>
            <p className="font-medium text-gray-800">Základní rozpočet (provedeno, bez DPH)</p>
            <p>
              Vyfakturováno: <strong>{formatKc(invoicingSummary.base.invoicedNet)}</strong>
            </p>
            <p>
              Zbývá: <strong>{formatKc(invoicingSummary.base.remainingNet)}</strong>
            </p>
          </div>
          <div>
            <p className="font-medium text-gray-800">Vícepráce (provedeno, bez DPH)</p>
            <p>
              Vyfakturováno: <strong>{formatKc(invoicingSummary.extra.invoicedNet)}</strong>
            </p>
            <p>
              Zbývá: <strong>{formatKc(invoicingSummary.extra.remainingNet)}</strong>
            </p>
          </div>
          <div>
            <p className="font-medium text-gray-800">Celkem</p>
            <p>
              Vyfakturováno: <strong>{formatKc(invoicingSummary.all.invoicedNet)}</strong>
            </p>
            <p>
              Zbývá: <strong>{formatKc(invoicingSummary.all.remainingNet)}</strong>
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "Vše"],
            ["normal", "Základní rozpočet"],
            ["extra_work", "Vícepráce"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={rowFilter === key ? "default" : "outline"}
            onClick={() => setRowFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-gray-700">
          Zatím žádné položky. {canManage ? "Přidejte položku nebo použijte šablonu." : ""}
        </div>
      ) : (
        <>
        <div className="md:hidden space-y-2.5">
          {filteredItems.map((row) => (
            <div
              key={row.id}
              className={cn(
                "min-w-0 rounded-lg border border-slate-200 bg-white p-3 text-[13px] shadow-sm",
                row.done && "border-emerald-200 bg-emerald-50/50",
                isWorkBudgetRowFullyInvoiced(row) && "opacity-85"
              )}
            >
              <div className="flex flex-wrap items-start gap-2">
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 text-left text-[14px] font-semibold text-gray-950 break-words",
                    canManage && !isWorkBudgetRowFullyInvoiced(row) && "hover:underline"
                  )}
                  onClick={() => openEditItem(row)}
                  disabled={!canManage || isWorkBudgetRowFullyInvoiced(row)}
                >
                  {row.title || "—"}
                </button>
                <div className="flex flex-wrap gap-1">
                  {isExtraWorkItem(row) ? (
                    <Badge variant="outline" className="border-orange-400 bg-orange-50 font-semibold text-orange-950">
                      VÍCEPRÁCE
                    </Badge>
                  ) : null}
                  {row.done ? <Badge variant="secondary">Provedeno</Badge> : null}
                  <WorkBudgetInvoicingBadge row={row} />
                  {isExtraWorkItem(row) && workBudgetItemInvoicingStatus(row) === "none" ? (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      Nevyfakturováno
                    </Badge>
                  ) : null}
                </div>
              </div>
              {row.description ? (
                <p className="mt-1 text-xs text-gray-600 break-words">{row.description}</p>
              ) : null}
              <dl className="mt-2 grid grid-cols-1 gap-1 text-xs text-gray-800">
                <div className="flex justify-between gap-2">
                  <dt>Množství</dt>
                  <dd className="tabular-nums font-medium">
                    {row.quantity} {row.unit}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Cena bez DPH</dt>
                  <dd className="break-all text-right tabular-nums font-medium">{formatKc(row.amountNet)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>DPH</dt>
                  <dd className="tabular-nums">{row.vatRate} %</dd>
                </div>
                <div className="flex justify-between gap-2 border-t border-slate-100 pt-1">
                  <dt className="font-semibold text-gray-900">Celkem s DPH</dt>
                  <dd className="break-all text-right tabular-nums font-bold text-gray-950">
                    {formatKc(row.amountGross)}
                  </dd>
                </div>
              </dl>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                <Label className="text-xs text-gray-700">Provedeno</Label>
                <Checkbox
                  checked={row.done}
                  disabled={!canMarkDone || workBudgetItemInvoicingStatus(row) !== "none"}
                  onCheckedChange={(v) => void toggleDone(row, v === true)}
                  aria-label={`Provedeno: ${row.title}`}
                />
              </div>
              {canManage && workBudgetItemInvoicingStatus(row) === "none" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-1 h-9 w-full text-red-600"
                  onClick={() => void deleteItem(row)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Smazat položku
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
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
              {filteredItems.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-t border-slate-100",
                    row.done && "bg-emerald-50/70",
                    isWorkBudgetRowFullyInvoiced(row) && "opacity-80"
                  )}
                >
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      className={cn(
                        "text-left font-medium text-gray-950",
                        canManage && !isWorkBudgetRowFullyInvoiced(row) && "hover:underline"
                      )}
                      onClick={() => openEditItem(row)}
                      disabled={!canManage || isWorkBudgetRowFullyInvoiced(row)}
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
                      {isExtraWorkItem(row) ? (
                        <Badge variant="outline" className="border-orange-300 text-orange-900">
                          Vícepráce
                        </Badge>
                      ) : null}
                      {isExtraWorkItem(row) && !isApprovedExtraWorkItem(row) ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {row.extraWorkStatus === EXTRA_WORK_STATUSES.REJECTED
                            ? "Zamítnuto"
                            : "Návrh"}
                        </Badge>
                      ) : null}
                      {row.done ? <Badge variant="secondary">Provedeno</Badge> : null}
                      <WorkBudgetInvoicingBadge row={row} />
                      {isExtraWorkItem(row) && workBudgetItemInvoicingStatus(row) === "none" ? (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          Nevyfakturováno
                        </Badge>
                      ) : null}
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
                      disabled={
                        !canMarkDone || workBudgetItemInvoicingStatus(row) !== "none"
                      }
                      onCheckedChange={(v) => void toggleDone(row, v === true)}
                      aria-label={`Provedeno: ${row.title}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                    {doneAtLabel(row.doneAt)}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2">
                      {workBudgetItemInvoicingStatus(row) === "none" ? (
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
        </>
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
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="wb-extra-work" className="cursor-pointer">
                Vícepráce
              </Label>
              <Switch
                id="wb-extra-work"
                checked={draft.isExtraWork}
                onCheckedChange={(v) =>
                  setDraft((p) => ({
                    ...p,
                    isExtraWork: v,
                    extraWorkStatus: v ? EXTRA_WORK_STATUSES.DRAFT : EXTRA_WORK_STATUSES.DRAFT,
                  }))
                }
              />
            </div>
            {draft.isExtraWork ? (
              <div>
                <Label>Stav vícepráce</Label>
                <Select
                  value={draft.extraWorkStatus}
                  onValueChange={(v) =>
                    setDraft((p) => ({ ...p, extraWorkStatus: v as ExtraWorkStatus }))
                  }
                >
                  <SelectTrigger className={LIGHT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={LIGHT_SELECT_CONTENT_CLASS}>
                    <SelectItem value={EXTRA_WORK_STATUSES.DRAFT}>Návrh</SelectItem>
                    <SelectItem value={EXTRA_WORK_STATUSES.APPROVED}>Schváleno</SelectItem>
                    <SelectItem value={EXTRA_WORK_STATUSES.REJECTED}>Zamítnuto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
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

      <JobWorkBudgetInvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        items={items}
        advances={advances}
        busy={invoiceBusy}
        onConfirm={(payload) => void generateInvoice(payload)}
      />

      <JobWorkBudgetRegenerateDialog
        open={regenerateDialogOpen}
        onOpenChange={(o) => {
          setRegenerateDialogOpen(o);
          if (!o) setRegenerateTarget(null);
        }}
        invoice={regenerateTarget}
        items={items}
        advances={advances}
        busy={invoiceBusy}
        onConfirm={(ids) => void regenerateInvoice(ids)}
      />

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
