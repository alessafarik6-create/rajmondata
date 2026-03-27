"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  query,
  where,
  limit,
} from "firebase/firestore";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
  useDoc,
} from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FileText, Printer, PlusCircle, Plus, Trash2, Pencil } from "lucide-react";
import { buildCustomerAddressMultiline } from "@/lib/customer-address-display";
import type { JobBudgetBreakdown } from "@/lib/vat-calculations";
import { normalizeVatRate, resolveJobPaidFromFirestore } from "@/lib/vat-calculations";
import {
  computeSettlementAmounts,
  createAdvanceInvoiceFromContract,
  createFinalSettlementInvoice,
  createManualAdvanceInvoice,
  createTaxReceiptForAdvancePayment,
  deleteJobInvoice,
  depositGrossKcFromContract,
  hasAdvanceTerms,
  JOB_INVOICE_TYPES,
  type ManualAdvanceLineInput,
  type OrgBankAccountRow,
  type WorkContractLike,
} from "@/lib/job-billing-invoices";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { User } from "firebase/auth";
import { cn } from "@/lib/utils";
import { printInvoiceHtmlDocument } from "@/lib/print-html";

const VAT_OPTIONS = [0, 12, 21] as const;

type Props = {
  companyId: string;
  jobId: string;
  job: Record<string, unknown> | null | undefined;
  jobName: string;
  customerId: string | null | undefined;
  customerName: string;
  customerAddressLines: string;
  jobBudgetBreakdown: JobBudgetBreakdown | null;
  workContractsForJob: WorkContractLike[];
  companyDoc: Record<string, unknown> | null | undefined;
  companyDisplayName: string;
  user: User | null;
  canManage: boolean;
  /** Stav zakázky (např. dokončená) — pro vyúčtovací fakturu. */
  jobStatus: string;
};

export function JobBillingInvoicesSection({
  companyId,
  jobId,
  job,
  jobName,
  customerId,
  customerName,
  customerAddressLines,
  jobBudgetBreakdown,
  workContractsForJob,
  companyDoc,
  companyDisplayName,
  user,
  canManage,
  jobStatus,
}: Props) {
  const firestore = useFirestore();
  const { toast } = useToast();

  const customerRef = useMemoFirebase(
    () =>
      firestore && companyId && customerId
        ? doc(firestore, "companies", companyId, "customers", String(customerId))
        : null,
    [firestore, companyId, customerId]
  );
  const { data: customerDoc } = useDoc(customerRef);

  const bankAccountsColRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, "companies", companyId, "bankAccounts")
        : null,
    [firestore, companyId]
  );
  const { data: bankAccountsRaw } = useCollection(bankAccountsColRef);

  const orgBankAccounts = useMemo(
    () => (Array.isArray(bankAccountsRaw) ? bankAccountsRaw : []) as OrgBankAccountRow[],
    [bankAccountsRaw]
  );

  const legacyCompanyBank = useMemo(() => {
    const c = companyDoc as { bankAccountNumber?: string } | null | undefined;
    return String(c?.bankAccountNumber ?? "").trim() || null;
  }, [companyDoc]);

  const supplierIco = useMemo(() => {
    const c = companyDoc as { ico?: string } | null | undefined;
    const v = String(c?.ico ?? "").trim();
    return v || null;
  }, [companyDoc]);

  const supplierDic = useMemo(() => {
    const c = companyDoc as { dic?: string } | null | undefined;
    const v = String(c?.dic ?? "").trim();
    return v || null;
  }, [companyDoc]);

  const customerIco = useMemo(() => {
    const c = customerDoc as { ico?: string } | null | undefined;
    const v = String(c?.ico ?? "").trim();
    return v || null;
  }, [customerDoc]);

  const customerDic = useMemo(() => {
    const c = customerDoc as { dic?: string } | null | undefined;
    const v = String(c?.dic ?? "").trim();
    return v || null;
  }, [customerDoc]);

  const printDocHtml = useCallback(
    (docTitle: string, pdfHtml: string) => {
      const r = printInvoiceHtmlDocument(pdfHtml, docTitle);
      if (r === "blocked") {
        toast({
          variant: "destructive",
          title: "Tisk byl zablokován",
          description:
            "Povolte vyskakovací okna pro tento web nebo zkuste znovu z detailu dokladu.",
        });
      }
    },
    [toast]
  );

  const [creatingAdvance, setCreatingAdvance] = useState(false);
  const [taxDialogOpen, setTaxDialogOpen] = useState(false);
  const [taxTarget, setTaxTarget] = useState<{
    id: string;
    invoiceNumber: string;
    amountGross: number;
  } | null>(null);
  const [taxPaidGross, setTaxPaidGross] = useState("");
  const [taxPaymentDate, setTaxPaymentDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [taxVs, setTaxVs] = useState("");
  const [taxNote, setTaxNote] = useState("");
  const [savingTax, setSavingTax] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualLines, setManualLines] = useState<ManualAdvanceLineInput[]>([
    { description: "", quantity: 1, unit: "ks", unitPriceNet: 0, vatRate: 21 },
  ]);
  const [creatingManual, setCreatingManual] = useState(false);
  const [creatingSettlement, setCreatingSettlement] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const organizationLogoUrl = useMemo(() => {
    const u = (companyDoc as { organizationLogoUrl?: string | null })?.organizationLogoUrl;
    return u && String(u).trim() ? String(u).trim() : null;
  }, [companyDoc]);

  const supplierName =
    String(
      (companyDoc as { companyName?: string })?.companyName ??
        companyDisplayName ??
        ""
    ).trim() || "Dodavatel";
  const supplierAddressLines = useMemo(
    () => buildCustomerAddressMultiline(companyDoc),
    [companyDoc]
  );

  const budgetGross = jobBudgetBreakdown?.budgetGross ?? null;

  const primaryContract = useMemo(() => {
    for (const c of workContractsForJob) {
      if (hasAdvanceTerms(c, budgetGross)) return c;
    }
    return null;
  }, [workContractsForJob, budgetGross]);

  const jobInvoicesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId) return null;
    return query(
      collection(firestore, "companies", companyId, "invoices"),
      where("jobId", "==", jobId),
      limit(60)
    );
  }, [firestore, companyId, jobId]);

  const { data: jobInvoicesRaw = [], isLoading: invLoading } =
    useCollection(jobInvoicesQuery);

  const jobInvoices = useMemo(() => {
    const rows = Array.isArray(jobInvoicesRaw) ? jobInvoicesRaw : [];
    return [...rows].sort((a, b) => {
      const ta = (a as { createdAt?: unknown }).createdAt;
      const tb = (b as { createdAt?: unknown }).createdAt;
      const na =
        ta && typeof ta === "object" && "toMillis" in (ta as object)
          ? (ta as { toMillis: () => number }).toMillis()
          : 0;
      const nb =
        tb && typeof tb === "object" && "toMillis" in (tb as object)
          ? (tb as { toMillis: () => number }).toMillis()
          : 0;
      return nb - na;
    });
  }, [jobInvoicesRaw]);

  const jobPaid = useMemo(
    () => resolveJobPaidFromFirestore(job),
    [job]
  );

  const remainingGross = useMemo(() => {
    if (jobBudgetBreakdown == null) return null;
    return Math.max(
      0,
      Math.round((jobBudgetBreakdown.budgetGross - jobPaid.paidGross) * 100) / 100
    );
  }, [jobBudgetBreakdown, jobPaid.paidGross]);

  const settlementPreview = useMemo(() => {
    if (jobBudgetBreakdown == null) return null;
    const primary =
      workContractsForJob.find((c) => hasAdvanceTerms(c, budgetGross)) ??
      workContractsForJob[0] ??
      null;
    const rows = jobInvoices.map((inv) => {
      const r = inv as Record<string, unknown> & { id: string };
      return {
        id: r.id,
        type: r.type as string | undefined,
        invoiceNumber: r.invoiceNumber as string | undefined,
        paidGrossReceived: r.paidGrossReceived,
        amountGross: r.amountGross,
      };
    });
    return computeSettlementAmounts({
      budgetGross: jobBudgetBreakdown.budgetGross,
      advanceInvoices: rows,
      contractFallback: rows.some((x) => x.type === JOB_INVOICE_TYPES.ADVANCE)
        ? null
        : primary,
    });
  }, [jobBudgetBreakdown, jobInvoices, workContractsForJob, budgetGross]);

  const hasFinalSettlement = useMemo(
    () =>
      jobInvoices.some(
        (inv) =>
          String((inv as { type?: string }).type ?? "") === JOB_INVOICE_TYPES.FINAL_INVOICE
      ),
    [jobInvoices]
  );

  const canCreateSettlement =
    canManage &&
    Boolean(customerId && String(customerId).trim()) &&
    jobBudgetBreakdown != null &&
    !hasFinalSettlement &&
    (jobStatus === "dokončená" ||
      jobStatus === "čeká" ||
      jobStatus === "fakturována");

  const canCreateAdvance =
    canManage &&
    Boolean(customerId && String(customerId).trim()) &&
    primaryContract != null &&
    jobBudgetBreakdown != null;

  const canCreateManualAdvance =
    canManage &&
    Boolean(customerId && String(customerId).trim()) &&
    jobBudgetBreakdown != null;

  const handleCreateAdvance = async () => {
    if (!user || !primaryContract || !jobBudgetBreakdown || !customerId) return;
    setCreatingAdvance(true);
    try {
      const { pdfHtml } = await createAdvanceInvoiceFromContract({
        firestore,
        companyId,
        jobId,
        jobName,
        customerId: String(customerId),
        customerName,
        customerAddressLines:
          customerAddressLines || customerName,
        supplierName,
        supplierAddressLines:
          supplierAddressLines || supplierName,
        contract: primaryContract,
        budget: jobBudgetBreakdown,
        userId: user.uid,
        logoUrl: organizationLogoUrl,
        orgBankAccounts,
        legacyCompanyBankAccount: legacyCompanyBank,
        supplierIco,
        supplierDic,
        customerIco,
        customerDic,
      });
      toast({
        title: "Zálohová faktura vytvořena",
        description: "Dokument je v seznamu níže a v sekci Faktury.",
      });
      if (pdfHtml) printDocHtml("Zálohová faktura", pdfHtml);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nelze vytvořit",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setCreatingAdvance(false);
    }
  };

  const addManualLine = () => {
    setManualLines((prev) => [
      ...prev,
      { description: "", quantity: 1, unit: "ks", unitPriceNet: 0, vatRate: 21 },
    ]);
  };

  const removeManualLine = (idx: number) => {
    setManualLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateManualLine = (idx: number, patch: Partial<ManualAdvanceLineInput>) => {
    setManualLines((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };

  const openManualDialog = () => {
    setManualLines([{ description: "", quantity: 1, unit: "ks", unitPriceNet: 0, vatRate: 21 }]);
    setManualOpen(true);
  };

  const handleCreateManualAdvance = async () => {
    if (!user || !jobBudgetBreakdown || !customerId) return;
    setCreatingManual(true);
    try {
      const { pdfHtml } = await createManualAdvanceInvoice({
        firestore,
        companyId,
        jobId,
        jobName,
        customerId: String(customerId),
        customerName,
        customerAddressLines: customerAddressLines || customerName,
        supplierName,
        supplierAddressLines: supplierAddressLines || supplierName,
        userId: user.uid,
        logoUrl: organizationLogoUrl,
        lines: manualLines,
        primaryWorkContract: primaryContract,
        orgBankAccounts,
        legacyCompanyBankAccount: legacyCompanyBank,
        supplierIco,
        supplierDic,
        customerIco,
        customerDic,
      });
      toast({
        title: "Vlastní zálohová faktura vytvořena",
        description: "Dokument je v seznamu a v sekci Faktury.",
      });
      setManualOpen(false);
      if (pdfHtml) printDocHtml("Zálohová faktura", pdfHtml);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nelze vytvořit",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setCreatingManual(false);
    }
  };

  const openTaxDialog = (row: {
    id: string;
    invoiceNumber?: string;
    amountGross?: unknown;
  }) => {
    const g = Number(row.amountGross) || 0;
    setTaxTarget({
      id: row.id,
      invoiceNumber: String(row.invoiceNumber ?? ""),
      amountGross: g,
    });
    setTaxPaidGross(String(g));
    setTaxPaymentDate(new Date().toISOString().slice(0, 10));
    setTaxVs("");
    setTaxNote("");
    setTaxDialogOpen(true);
  };

  const handleSaveTaxReceipt = async () => {
    if (!user || !taxTarget || !jobBudgetBreakdown || !customerId) return;
    const paid = Number(String(taxPaidGross).replace(",", "."));
    if (!Number.isFinite(paid) || paid <= 0) {
      toast({
        variant: "destructive",
        title: "Neplatná částka",
        description: "Zadejte uhrazenou částku s DPH.",
      });
      return;
    }
    setSavingTax(true);
    try {
      const { pdfHtml: receiptHtml } = await createTaxReceiptForAdvancePayment({
        firestore,
        companyId,
        jobId,
        jobName,
        jobDisplayName: jobName,
        customerId: String(customerId),
        customerName,
        customerAddressLines:
          customerAddressLines || customerName,
        supplierName,
        supplierAddressLines:
          supplierAddressLines || supplierName,
        advanceInvoiceId: taxTarget.id,
        advanceInvoiceNumber: taxTarget.invoiceNumber,
        advanceAmountGross: taxTarget.amountGross,
        paidGrossInput: paid,
        paymentDate: taxPaymentDate,
        variableSymbol: taxVs.trim() || undefined,
        note: taxNote.trim() || undefined,
        vatRate: normalizeVatRate(jobBudgetBreakdown.vatRate),
        userId: user.uid,
        logoUrl: organizationLogoUrl,
        orgBankAccounts,
        legacyCompanyBankAccount: legacyCompanyBank,
        supplierIco,
        supplierDic,
        customerIco,
        customerDic,
      });
      toast({
        title: "Daňový doklad vytvořen",
        description: "Platba je propsána do zakázky a do přehledu financí.",
      });
      if (receiptHtml) printDocHtml("Daňový doklad", receiptHtml);
      setTaxDialogOpen(false);
      setTaxTarget(null);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSavingTax(false);
    }
  };

  const printRow = (html: unknown) => {
    if (typeof html === "string" && html.trim()) {
      printDocHtml("Doklad", html);
    }
  };

  const handleCreateSettlement = async () => {
    if (!user || !jobBudgetBreakdown || !customerId) return;
    setCreatingSettlement(true);
    try {
      const rows = jobInvoices.map((inv) => {
        const r = inv as Record<string, unknown> & { id: string };
        return {
          id: r.id,
          type: r.type as string | undefined,
          invoiceNumber: r.invoiceNumber as string | undefined,
          paidGrossReceived: r.paidGrossReceived,
          amountGross: r.amountGross,
        };
      });
      const primary =
        workContractsForJob.find((c) => hasAdvanceTerms(c, budgetGross)) ??
        workContractsForJob[0] ??
        null;
      const { pdfHtml } = await createFinalSettlementInvoice({
        firestore,
        companyId,
        jobId,
        jobName,
        customerId: String(customerId),
        customerName,
        customerAddressLines: customerAddressLines || customerName,
        supplierName,
        supplierAddressLines: supplierAddressLines || supplierName,
        userId: user.uid,
        logoUrl: organizationLogoUrl,
        budget: jobBudgetBreakdown,
        advanceInvoices: rows,
        workContractsForJob,
        sourceContractId: primary?.id ?? null,
        orgBankAccounts,
        legacyCompanyBankAccount: legacyCompanyBank,
        supplierIco,
        supplierDic,
        customerIco,
        customerDic,
      });
      toast({
        title: "Vyúčtovací faktura vytvořena",
        description: "Dokument je v seznamu a v sekci Faktury.",
      });
      if (pdfHtml) printDocHtml("Vyúčtovací faktura", pdfHtml);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nelze vytvořit",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setCreatingSettlement(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!window.confirm("Opravdu smazat tento doklad? Akci nelze vrátit.")) return;
    setDeletingId(invoiceId);
    try {
      await deleteJobInvoice({
        firestore,
        companyId,
        jobId,
        invoiceId,
      });
      toast({ title: "Doklad byl smazán" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nelze smazat",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Card
        className={cn(
          "border-2 border-neutral-950 bg-white text-neutral-950 shadow-sm"
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <FileText className="h-4 w-4" aria-hidden />
            Fakturace — záloha a daňové doklady
          </CardTitle>
          <p className="text-sm text-neutral-800">
            Rozpočet zakázky (s DPH):{" "}
            <strong>
              {jobBudgetBreakdown
                ? `${jobBudgetBreakdown.budgetGross.toLocaleString("cs-CZ")} Kč`
                : "—"}
            </strong>
            {" · "}Přijato celkem:{" "}
            <strong>{jobPaid.paidGross.toLocaleString("cs-CZ")} Kč</strong>
            {" · "}Zbývá doplatit:{" "}
            <strong>
              {remainingGross != null
                ? `${remainingGross.toLocaleString("cs-CZ")} Kč`
                : "—"}
            </strong>
          </p>
          {settlementPreview && jobBudgetBreakdown ? (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800">
              <div className="font-semibold text-neutral-950">Vyúčtování (náhled)</div>
              <div>
                Celková cena zakázky (s DPH):{" "}
                <strong>{settlementPreview.totalContractGross.toLocaleString("cs-CZ")} Kč</strong>
              </div>
              <div>
                Odečtené zálohy ({settlementPreview.advanceSource === "contract" ? "smlouva" : settlementPreview.advanceSource === "invoices" ? "zálohové faktury" : "—"}
                ):{" "}
                <strong>{settlementPreview.totalAdvancePaid.toLocaleString("cs-CZ")} Kč</strong>
              </div>
              <div>
                Doplatek:{" "}
                <strong>{settlementPreview.amountToPay.toLocaleString("cs-CZ")} Kč s DPH</strong>
              </div>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {canCreateSettlement ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="gap-2 border-neutral-950"
                disabled={creatingSettlement}
                onClick={() => void handleCreateSettlement()}
              >
                {creatingSettlement ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Vyúčtovat zakázku (finální faktura)
              </Button>
              <span className="text-xs text-neutral-700">
                Stav zakázky: <strong>{jobStatus}</strong> — vytvoří vyúčtovací fakturu s odečtem záloh.
              </span>
            </div>
          ) : hasFinalSettlement ? (
            <p className="text-xs text-neutral-700">Vyúčtovací faktura k této zakázce již existuje.</p>
          ) : null}
          {canCreateAdvance || canCreateManualAdvance ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {canCreateAdvance ? (
                  <Button
                    type="button"
                    className="gap-2"
                    disabled={creatingAdvance}
                    onClick={() => void handleCreateAdvance()}
                  >
                    {creatingAdvance ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <PlusCircle className="h-4 w-4" />
                    )}
                    Vytvořit zálohovou fakturu
                  </Button>
                ) : null}
                {canCreateManualAdvance ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2 border-neutral-950"
                    disabled={creatingManual}
                    onClick={() => openManualDialog()}
                  >
                    {creatingManual ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Vlastní zálohová faktura
                  </Button>
                ) : null}
                {primaryContract && budgetGross != null && canCreateAdvance ? (
                  <span className="text-neutral-700">
                    Záloha dle smlouvy:{" "}
                    <strong>
                      {depositGrossKcFromContract(primaryContract, budgetGross).toLocaleString("cs-CZ")}{" "}
                      Kč s DPH
                    </strong>
                  </span>
                ) : null}
              </div>
              {canCreateManualAdvance && !canCreateAdvance ? (
                <p className="text-xs text-neutral-700">
                  Záloha dle smlouvy není k dispozici — použijte vlastní zálohovou fakturu s vlastními
                  položkami a sazbami DPH.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-neutral-700">
              {!canManage
                ? "Nemáte oprávnění vystavit fakturu."
                : !customerId
                  ? "Doplňte zákazníka u zakázky."
                  : !jobBudgetBreakdown
                    ? "Chybí platný rozpočet zakázky."
                    : "Nelze vystavit zálohovou fakturu."}
            </p>
          )}

          <div className="rounded-lg border border-neutral-200">
            <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 font-semibold">
              Doklady k této zakázce
            </div>
            {invLoading ? (
              <p className="p-4 text-neutral-700">Načítám…</p>
            ) : jobInvoices.length === 0 ? (
              <p className="p-4 text-neutral-700">Zatím žádné doklady.</p>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {jobInvoices.map((inv) => {
                  const row = inv as Record<string, unknown> & { id: string };
                  const t = String(row.type ?? "");
                  const label =
                    t === JOB_INVOICE_TYPES.ADVANCE
                      ? "Zálohová faktura"
                      : t === JOB_INVOICE_TYPES.TAX_RECEIPT
                        ? "Daňový doklad k přijaté platbě"
                        : t === JOB_INVOICE_TYPES.FINAL_INVOICE
                          ? "Vyúčtovací faktura"
                          : "Faktura / doklad";
                  const st = String(row.status ?? "");
                  const num = String(row.invoiceNumber ?? row.documentNumber ?? "—");
                  const displayGross =
                    t === JOB_INVOICE_TYPES.FINAL_INVOICE
                      ? Number(
                          (row as { amountToPay?: unknown }).amountToPay ??
                            row.amountGross ??
                            0
                        )
                      : Number(row.amountGross ?? row.paidAmount ?? 0);
                  return (
                    <li
                      key={row.id}
                      className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="font-medium text-neutral-950">{label}</div>
                        <div className="text-xs text-neutral-800">
                          {num} · stav: {st || "—"} · částka s DPH:{" "}
                          {Number(row.amountGross ?? row.paidAmount ?? 0).toLocaleString("cs-CZ")}{" "}
                          Kč
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1 border-neutral-950"
                          asChild
                        >
                          <Link href={`/portal/invoices/${row.id}`}>Otevřít</Link>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1 border-neutral-950"
                          onClick={() => printRow(row.pdfHtml)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Tisk / PDF
                        </Button>
                        {(t === JOB_INVOICE_TYPES.ADVANCE || t === JOB_INVOICE_TYPES.FINAL_INVOICE) &&
                        canManage ? (
                          <Button type="button" variant="outline" size="sm" className="gap-1" asChild>
                            <Link href={`/portal/invoices/${row.id}/edit`}>
                              <Pencil className="h-3.5 w-3.5" />
                              Upravit
                            </Link>
                          </Button>
                        ) : null}
                        {canManage &&
                        (t === JOB_INVOICE_TYPES.ADVANCE || t === JOB_INVOICE_TYPES.FINAL_INVOICE) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-destructive"
                            disabled={deletingId === row.id}
                            onClick={() => void handleDeleteInvoice(row.id)}
                          >
                            {deletingId === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Smazat
                          </Button>
                        ) : null}
                        {t === JOB_INVOICE_TYPES.ADVANCE &&
                        st !== "paid" &&
                        canManage ? (
                          <Button
                            type="button"
                            size="sm"
                            className="gap-1"
                            onClick={() =>
                              openTaxDialog({
                                id: row.id,
                                invoiceNumber: num,
                                amountGross: row.amountGross,
                              })
                            }
                          >
                            Daňový doklad k platbě
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={taxDialogOpen} onOpenChange={setTaxDialogOpen}>
        <DialogContent className="max-w-md border-neutral-200 bg-white text-neutral-950">
          <DialogHeader>
            <DialogTitle>Přijatá platba — daňový doklad</DialogTitle>
            <DialogDescription className="text-neutral-800">
              Vyplňte datum připsání platby a částku (s DPH). Doklad se uloží a
              přičte se k uhrazené částce zakázky.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Datum přijetí platby</Label>
              <Input
                type="date"
                value={taxPaymentDate}
                onChange={(e) => setTaxPaymentDate(e.target.value)}
                className="border-neutral-950"
              />
            </div>
            <div>
              <Label>Uhrazená částka (s DPH)</Label>
              <Input
                value={taxPaidGross}
                onChange={(e) => setTaxPaidGross(e.target.value)}
                placeholder="např. 50000"
                className="border-neutral-950"
              />
            </div>
            <div>
              <Label>Variabilní symbol (volitelně)</Label>
              <Input
                value={taxVs}
                onChange={(e) => setTaxVs(e.target.value)}
                className="border-neutral-950"
              />
            </div>
            <div>
              <Label>Poznámka (volitelně)</Label>
              <Textarea
                value={taxNote}
                onChange={(e) => setTaxNote(e.target.value)}
                rows={2}
                className="border-neutral-950"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-neutral-950"
              onClick={() => setTaxDialogOpen(false)}
            >
              Zrušit
            </Button>
            <Button type="button" disabled={savingTax} onClick={() => void handleSaveTaxReceipt()}>
              {savingTax ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Vytvořit doklad"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-neutral-200 bg-white text-neutral-950">
          <DialogHeader>
            <DialogTitle>Vlastní zálohová faktura</DialogTitle>
            <DialogDescription className="text-neutral-800">
              Odběratel odpovídá zákazníkovi u zakázky. Upravte položky, množství, ceny bez DPH a sazbu DPH
              (0 / 12 / 21 %).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addManualLine}>
                <Plus className="h-4 w-4" />
                Přidat položku
              </Button>
            </div>
            {manualLines.map((line, idx) => (
              <div
                key={idx}
                className="grid gap-2 rounded-md border border-neutral-100 p-3 sm:grid-cols-2 lg:grid-cols-12"
              >
                <div className="sm:col-span-2 lg:col-span-5">
                  <Label>Popis</Label>
                  <Input
                    value={line.description}
                    onChange={(e) => updateManualLine(idx, { description: e.target.value })}
                    className="border-neutral-950"
                  />
                </div>
                <div className="lg:col-span-2">
                  <Label>Množství</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) =>
                      updateManualLine(idx, {
                        quantity: Number(e.target.value.replace(",", ".")) || 0,
                      })
                    }
                    className="border-neutral-950"
                  />
                </div>
                <div className="lg:col-span-1">
                  <Label>j.</Label>
                  <Input
                    value={line.unit}
                    onChange={(e) => updateManualLine(idx, { unit: e.target.value })}
                    className="border-neutral-950"
                  />
                </div>
                <div className="lg:col-span-2">
                  <Label>Cena bez DPH (jednotková)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.unitPriceNet}
                    onChange={(e) =>
                      updateManualLine(idx, {
                        unitPriceNet: Number(e.target.value.replace(",", ".")) || 0,
                      })
                    }
                    className="border-neutral-950"
                  />
                </div>
                <div className="lg:col-span-2">
                  <Label>DPH</Label>
                  <Select
                    value={String(line.vatRate)}
                    onValueChange={(v) =>
                      updateManualLine(idx, { vatRate: normalizeVatRate(Number(v)) })
                    }
                  >
                    <SelectTrigger className="border-neutral-950">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VAT_OPTIONS.map((r) => (
                        <SelectItem key={r} value={String(r)}>
                          {r} %
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-end lg:col-span-12">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    aria-label="Smazat položku"
                    onClick={() => removeManualLine(idx)}
                    disabled={manualLines.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="border-neutral-950" onClick={() => setManualOpen(false)}>
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={creatingManual}
              onClick={() => void handleCreateManualAdvance()}
            >
              {creatingManual ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Vytvořit fakturu"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
