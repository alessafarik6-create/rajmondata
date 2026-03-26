"use client";

import React, { useMemo, useState } from "react";
import {
  collection,
  query,
  where,
  limit,
} from "firebase/firestore";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
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
import { Loader2, FileText, Printer, PlusCircle } from "lucide-react";
import { buildCustomerAddressMultiline } from "@/lib/customer-address-display";
import type { JobBudgetBreakdown } from "@/lib/vat-calculations";
import { normalizeVatRate, resolveJobPaidFromFirestore } from "@/lib/vat-calculations";
import {
  createAdvanceInvoiceFromContract,
  createTaxReceiptForAdvancePayment,
  depositGrossKcFromContract,
  hasAdvanceTerms,
  JOB_INVOICE_TYPES,
  type WorkContractLike,
} from "@/lib/job-billing-invoices";
import type { User } from "firebase/auth";
import { cn } from "@/lib/utils";

function openPrintableHtml(title: string, html: string) {
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = title;
}

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
}: Props) {
  const firestore = useFirestore();
  const { toast } = useToast();

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

  const canCreateAdvance =
    canManage &&
    Boolean(customerId && String(customerId).trim()) &&
    primaryContract != null &&
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
      });
      toast({
        title: "Zálohová faktura vytvořena",
        description: "Dokument je v seznamu níže a v sekci Faktury.",
      });
      if (pdfHtml) openPrintableHtml("Zálohová faktura", pdfHtml);
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
      });
      toast({
        title: "Daňový doklad vytvořen",
        description: "Platba je propsána do zakázky a do přehledu financí.",
      });
      if (receiptHtml) openPrintableHtml("Daňový doklad", receiptHtml);
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
      openPrintableHtml("Doklad", html);
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
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {canCreateAdvance ? (
            <div className="flex flex-wrap items-center gap-2">
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
              {primaryContract && budgetGross != null ? (
                <span className="text-neutral-700">
                  Záloha dle smlouvy:{" "}
                  <strong>
                    {depositGrossKcFromContract(primaryContract, budgetGross).toLocaleString("cs-CZ")}{" "}
                    Kč s DPH
                  </strong>
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-neutral-700">
              {!canManage
                ? "Nemáte oprávnění vystavit fakturu."
                : !customerId
                  ? "Doplňte zákazníka u zakázky."
                  : !primaryContract
                    ? "Chybí smlouva o dílo se zálohou (částka nebo procento) a platný rozpočet."
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
                        : "Faktura / doklad";
                  const st = String(row.status ?? "");
                  const num = String(row.invoiceNumber ?? row.documentNumber ?? "—");
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
                          onClick={() => printRow(row.pdfHtml)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Tisk / PDF
                        </Button>
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
    </>
  );
}
