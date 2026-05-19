"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  collection,
  limit,
  orderBy,
  query,
  where,
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, Send } from "lucide-react";
import {
  DOCUMENT_EMAIL_TYPE_LABELS,
  type DocumentEmailTemplateVars,
  type DocumentEmailType,
  getEmailTemplate,
  hasNonEmptyTextSubjectAndBody,
  isValidEmailAddress,
  normalizeEmailBodyToHtml,
  parseCommaSeparatedEmails,
  readDocumentEmailOutbound,
  substituteDocumentEmailVariables,
} from "@/lib/document-email-outbound";
import { sendJobDocumentEmailFromBrowser } from "@/lib/document-email-send-client";
import {
  JOB_INVOICE_TYPES,
  selectPrimaryWorkContractForBilling,
  type WorkContractLike,
} from "@/lib/job-billing-invoices";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { roundMoney2, type JobBudgetBreakdown } from "@/lib/vat-calculations";
import {
  attachmentRefsFromOptions,
  buildCompanyDocumentAttachmentOptions,
  buildProductionSheetAttachmentOptions,
  buildWorkContractAttachmentOptions,
  formatAttachmentSizeBytes,
  type JobDocumentEmailAttachmentOption,
} from "@/lib/job-document-email-attachments";
import { INQUIRY_OFFER_COPY_MODE_LABELS } from "@/lib/inquiry-offer-copy";
import type { InquiryOfferCopyMode } from "@/lib/inquiry-offer-copy";

type EmailLogRow = {
  id: string;
  type?: string;
  to?: string;
  cc?: string[];
  subject?: string;
  status?: string;
  errorMessage?: string | null;
  sentAt?: { toDate?: () => Date } | null;
  documentUrl?: string | null;
  sentByEmail?: string | null;
  sentByUid?: string | null;
  attachmentFilenames?: string[];
  mainDocumentFilename?: string | null;
  attachmentDetails?: { filename?: string; source?: string }[];
  offerCopyTo?: string[];
  offerCopyMode?: InquiryOfferCopyMode | null;
};

function appOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin.replace(/\/$/, "");
}

function formatLogDate(row: EmailLogRow): string {
  const t = row.sentAt;
  try {
    if (t && typeof t.toDate === "function") {
      return t.toDate().toLocaleString("cs-CZ");
    }
  } catch {
    /* ignore */
  }
  return "—";
}

function formatLogAttachments(row: EmailLogRow): string | null {
  const names = Array.isArray(row.attachmentFilenames)
    ? row.attachmentFilenames.filter(Boolean)
    : [];
  if (names.length === 0) return null;
  return `Přílohy: ${names.join(", ")}`;
}

type Props = {
  companyId: string;
  jobId: string;
  job: Record<string, unknown> | null | undefined;
  companyDoc: Record<string, unknown> | null | undefined;
  companyDisplayName: string;
  customerName: string;
  customerEmail: string;
  workContractsForJob: WorkContractLike[];
  jobBudgetBreakdown: JobBudgetBreakdown | null;
  canManage: boolean;
};

export function JobDocumentEmailSection({
  companyId,
  jobId,
  job,
  companyDoc,
  companyDisplayName,
  customerName,
  customerEmail,
  workContractsForJob,
  jobBudgetBreakdown,
  canManage,
}: Props) {
  const firestore = useFirestore();
  const { toast } = useToast();

  const jobInvoicesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId) return null;
    return query(
      collection(firestore, "companies", companyId, "invoices"),
      where("jobId", "==", jobId),
      limit(80)
    );
  }, [firestore, companyId, jobId]);

  const jobDocumentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId) return null;
    return query(
      collection(firestore, "companies", companyId, "documents"),
      where("jobId", "==", jobId),
      limit(120)
    );
  }, [firestore, companyId, jobId]);

  const productionSheetsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId) return null;
    return query(
      collection(firestore, "companies", companyId, "jobs", jobId, "productionSheets"),
      limit(40)
    );
  }, [firestore, companyId, jobId]);

  const { data: jobInvoicesRaw = [] } = useCollection(jobInvoicesQuery);
  const { data: jobDocumentsRaw = [] } = useCollection(jobDocumentsQuery);
  const { data: productionSheetsRaw = [] } = useCollection(productionSheetsQuery);

  const jobInvoices = useMemo(() => {
    const rows = (Array.isArray(jobInvoicesRaw) ? jobInvoicesRaw : []).filter(
      (inv) => isActiveFirestoreDoc(inv as { isDeleted?: unknown })
    );
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

  const primaryContract = useMemo(
    () =>
      selectPrimaryWorkContractForBilling(
        workContractsForJob,
        jobBudgetBreakdown?.budgetGross ?? null
      ),
    [workContractsForJob, jobBudgetBreakdown]
  );

  const latestFinalInvoice = useMemo(() => {
    const finals = jobInvoices.filter(
      (inv) =>
        String((inv as { type?: string }).type ?? "") === JOB_INVOICE_TYPES.FINAL_INVOICE
    );
    return (finals[0] as Record<string, unknown> & { id: string }) ?? null;
  }, [jobInvoices]);

  const latestAdvanceInvoice = useMemo(() => {
    const adv = jobInvoices.filter(
      (inv) =>
        String((inv as { type?: string }).type ?? "") === JOB_INVOICE_TYPES.ADVANCE
    );
    return (adv[0] as Record<string, unknown> & { id: string }) ?? null;
  }, [jobInvoices]);

  const attachmentOptions = useMemo((): JobDocumentEmailAttachmentOption[] => {
    const contracts = buildWorkContractAttachmentOptions(workContractsForJob);
    const docs = buildCompanyDocumentAttachmentOptions(
      (Array.isArray(jobDocumentsRaw) ? jobDocumentsRaw : [])
        .filter((d) => isActiveFirestoreDoc(d as { isDeleted?: unknown }))
        .map((d) => {
          const row = d as Record<string, unknown> & { id: string };
          return {
            id: row.id,
            fileName: row.fileName as string | null,
            mimeType: row.mimeType as string | null,
            sizeBytes:
              typeof row.sizeBytes === "number"
                ? row.sizeBytes
                : typeof row.fileSize === "number"
                  ? row.fileSize
                  : null,
            storagePath: row.storagePath as string | null,
            fileUrl: (row.fileUrl ?? row.downloadURL) as string | null,
            source: row.source as string | null,
            jobLinkedKind: row.jobLinkedKind as string | null,
          };
        })
    );
    const sheets = buildProductionSheetAttachmentOptions(
      (Array.isArray(productionSheetsRaw) ? productionSheetsRaw : []).map((s) => {
        const row = s as Record<string, unknown> & { id: string };
        return {
          id: row.id,
          fileName: row.fileName as string | null,
          fileUrl: row.fileUrl as string | null,
          storagePath: row.storagePath as string | null,
          sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : null,
        };
      })
    );
    return [...contracts, ...docs, ...sheets];
  }, [workContractsForJob, jobDocumentsRaw, productionSheetsRaw]);

  const logsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId) return null;
    return query(
      collection(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId,
        "documentEmailLogs"
      ),
      orderBy("sentAt", "desc"),
      limit(40)
    );
  }, [firestore, companyId, jobId]);

  const { data: emailLogsRaw = [], error: logsError } = useCollection(logsQuery);
  const emailLogs = useMemo(
    () => (Array.isArray(emailLogsRaw) ? emailLogsRaw : []) as EmailLogRow[],
    [emailLogsRaw]
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<DocumentEmailType>("contract");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyPlain, setBodyPlain] = useState("");
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [includeMainDocument, setIncludeMainDocument] = useState(true);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<string>>(
    () => new Set()
  );
  const [sending, setSending] = useState(false);

  const outbound = useMemo(
    () => readDocumentEmailOutbound(companyDoc ?? undefined),
    [companyDoc]
  );

  const supportsMainDocument = useMemo(
    () =>
      modalType === "contract" ||
      modalType === "invoice" ||
      modalType === "advance_invoice",
    [modalType]
  );

  const buildVars = useCallback(
    (type: DocumentEmailType): DocumentEmailTemplateVars | null => {
      const origin = appOrigin();
      const firm = companyDisplayName.trim() || "Organizace";
      const jmeno = customerName.trim() || "—";
      const jobLink = origin ? `${origin}/portal/jobs/${jobId}` : `/portal/jobs/${jobId}`;
      const jobLabel =
        job && String(job.name ?? "").trim() ? String(job.name).trim() : jobId.slice(0, 8);

      if (type === "job_attachments") {
        return {
          nazev_firmy: firm,
          jmeno_zakaznika: jmeno,
          cislo_dokladu: jobLabel,
          datum: new Date().toLocaleDateString("cs-CZ"),
          castka: "—",
          odkaz_na_dokument: jobLink,
        };
      }
      if (type === "contract") {
        if (!primaryContract) return null;
        const num =
          String(primaryContract.contractNumber ?? "").trim() || primaryContract.id;
        const datum =
          String((primaryContract as { contractDateLabel?: string }).contractDateLabel ?? "").trim() ||
          new Date().toLocaleDateString("cs-CZ");
        const castka =
          jobBudgetBreakdown != null
            ? `${roundMoney2(jobBudgetBreakdown.budgetGross).toLocaleString("cs-CZ")} Kč`
            : "—";
        return {
          nazev_firmy: firm,
          jmeno_zakaznika: jmeno,
          cislo_dokladu: num,
          datum,
          castka,
          odkaz_na_dokument: jobLink,
        };
      }
      if (type === "invoice") {
        if (!latestFinalInvoice) return null;
        const num =
          String(latestFinalInvoice.invoiceNumber ?? latestFinalInvoice.documentNumber ?? "").trim() ||
          latestFinalInvoice.id;
        const gross = roundMoney2(
          Number(latestFinalInvoice.amountGross ?? latestFinalInvoice.totalAmount ?? 0)
        );
        const castka = `${gross.toLocaleString("cs-CZ")} Kč`;
        const invId = String(latestFinalInvoice.id ?? "").trim();
        const link = origin ? `${origin}/portal/invoices/${invId}` : `/portal/invoices/${invId}`;
        const datum =
          String(latestFinalInvoice.issueDate ?? latestFinalInvoice.date ?? "").trim() ||
          new Date().toLocaleDateString("cs-CZ");
        return {
          nazev_firmy: firm,
          jmeno_zakaznika: jmeno,
          cislo_dokladu: num,
          datum,
          castka,
          odkaz_na_dokument: link,
        };
      }
      if (!latestAdvanceInvoice) return null;
      const num =
        String(
          latestAdvanceInvoice.invoiceNumber ?? latestAdvanceInvoice.documentNumber ?? ""
        ).trim() || latestAdvanceInvoice.id;
      const gross = roundMoney2(
        Number(latestAdvanceInvoice.amountGross ?? latestAdvanceInvoice.totalAmount ?? 0)
      );
      const castka = `${gross.toLocaleString("cs-CZ")} Kč`;
      const invId = String(latestAdvanceInvoice.id ?? "").trim();
      const link = origin ? `${origin}/portal/invoices/${invId}` : `/portal/invoices/${invId}`;
      const datum =
        String(latestAdvanceInvoice.issueDate ?? latestAdvanceInvoice.date ?? "").trim() ||
        new Date().toLocaleDateString("cs-CZ");
      return {
        nazev_firmy: firm,
        jmeno_zakaznika: jmeno,
        cislo_dokladu: num,
        datum,
        castka,
        odkaz_na_dokument: link,
      };
    },
    [
      companyDisplayName,
      customerName,
      job,
      jobBudgetBreakdown,
      jobId,
      latestAdvanceInvoice,
      latestFinalInvoice,
      primaryContract,
    ]
  );

  const toggleAttachment = (id: string, checked: boolean) => {
    setSelectedAttachmentIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const openModal = (type: DocumentEmailType) => {
    if (type === "job_attachments" && attachmentOptions.length === 0) {
      toast({
        variant: "destructive",
        title: "Žádné přílohy",
        description:
          "K zakázce zatím nejsou smlouvy, dokumenty ani výrobní podklady ke odeslání.",
      });
      return;
    }

    const vars = buildVars(type);
    if (!vars) {
      toast({
        variant: "destructive",
        title: "Chybí dokument",
        description:
          type === "contract"
            ? "Nejdřív uložte smlouvu o dílo k této zakázce."
            : type === "invoice"
              ? "Nejdřív vytvořte výúčtovací fakturu."
              : "Nejdřív vytvořte zálohovou fakturu.",
      });
      return;
    }
    if (type === "invoice" && latestFinalInvoice) {
      const ph = String(
        (latestFinalInvoice as Record<string, unknown>).pdfHtml ?? ""
      ).trim();
      if (!ph) {
        toast({
          variant: "destructive",
          title: "Chybí obsah faktury",
          description: "Doklad nemá uložený obsah pro PDF. Otevřete fakturu a uložte ji znovu.",
        });
        return;
      }
    }
    if (type === "advance_invoice" && latestAdvanceInvoice) {
      const ph = String(
        (latestAdvanceInvoice as Record<string, unknown>).pdfHtml ?? ""
      ).trim();
      if (!ph) {
        toast({
          variant: "destructive",
          title: "Chybí obsah zálohy",
          description: "Doklad nemá uložený obsah pro PDF. Otevřete fakturu a uložte ji znovu.",
        });
        return;
      }
    }
    const tpl = getEmailTemplate(outbound, type);
    setModalType(type);
    setTo(String(customerEmail ?? "").trim());
    setCc("");
    setSubject(substituteDocumentEmailVariables(tpl.subject, vars));
    setBodyPlain(substituteDocumentEmailVariables(tpl.body, vars));
    setDocumentUrl(vars.odkaz_na_dokument);
    setIncludeMainDocument(type !== "job_attachments");
    setSelectedAttachmentIds(new Set());
    if (type === "contract") {
      setContractId(primaryContract?.id ?? null);
      setInvoiceId(null);
    } else if (type === "invoice") {
      setContractId(null);
      setInvoiceId(latestFinalInvoice?.id ?? null);
    } else if (type === "advance_invoice") {
      setContractId(null);
      setInvoiceId(latestAdvanceInvoice?.id ?? null);
    } else {
      setContractId(null);
      setInvoiceId(null);
    }
    setModalOpen(true);
  };

  const handleSend = async () => {
    if (!hasNonEmptyTextSubjectAndBody({ subject, bodyPlain })) {
      toast({
        variant: "destructive",
        title: "Vyplňte zprávu",
        description: "Předmět i text e-mailu nesmí být prázdné.",
      });
      return;
    }
    if (!isValidEmailAddress(to)) {
      toast({
        variant: "destructive",
        title: "Neplatný e-mail",
        description: "Zkontrolujte adresu příjemce.",
      });
      return;
    }
    const ccList = parseCommaSeparatedEmails(cc);
    for (const addr of ccList) {
      if (!isValidEmailAddress(addr)) {
        toast({
          variant: "destructive",
          title: "Neplatná kopie (CC)",
          description: `Zkontrolujte adresu: ${addr}`,
        });
        return;
      }
    }

    const sendMain = supportsMainDocument ? includeMainDocument : false;
    const extraRefs = attachmentRefsFromOptions(attachmentOptions, selectedAttachmentIds);

    if (modalType === "job_attachments" && extraRefs.length === 0) {
      toast({
        variant: "destructive",
        title: "Vyberte přílohy",
        description: "Označte alespoň jednu přílohu k odeslání.",
      });
      return;
    }
    if (!sendMain && extraRefs.length === 0) {
      toast({
        variant: "destructive",
        title: "Nic k odeslání",
        description: "Zapněte hlavní dokument nebo vyberte přílohy.",
      });
      return;
    }

    const html = normalizeEmailBodyToHtml(bodyPlain);
    setSending(true);
    try {
      await sendJobDocumentEmailFromBrowser({
        companyId,
        jobId,
        type: modalType,
        to: to.trim(),
        cc: cc.trim() || undefined,
        subject: subject.trim(),
        html,
        documentUrl,
        invoiceId,
        contractId,
        includeMainDocument: sendMain,
        extraAttachments: extraRefs.length > 0 ? extraRefs : undefined,
      });
      toast({
        title: "Odesláno",
        description:
          extraRefs.length > 0 && sendMain
            ? "E-mail s dokladem a vybranými přílohami byl odeslán."
            : extraRefs.length > 0
              ? "E-mail s vybranými přílohami byl odeslán."
              : "E-mail včetně PDF přílohy byl odeslán a zapsán do historie.",
      });
      setModalOpen(false);
    } catch (error) {
      toast({
        title: "Odeslání se nezdařilo",
        description: error instanceof Error ? error.message : "Neznámá chyba",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const jobName =
    job && String(job.name ?? "").trim() ? String(job.name).trim() : "Zakázka";

  const mainDocumentLabel =
    modalType === "contract"
      ? "Smlouva o dílo (PDF)"
      : modalType === "invoice"
        ? "Faktura (PDF)"
        : modalType === "advance_invoice"
          ? "Zálohová faktura (PDF)"
          : null;

  return (
    <>
      <Card className="border border-gray-200 bg-white shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-950">
            <Mail className="h-4 w-4 shrink-0 text-gray-600" aria-hidden />
            Odeslání dokumentu e-mailem
          </CardTitle>
          <p className="text-xs text-gray-600">
            Odeslání přes server (Resend) — PDF příloha se vygeneruje na serveru z uloženého dokladu.
            Můžete přidat další přílohy (smlouvy, dokumenty, fotodokumentace). Odesílatel a kopie dle
            nastavení organizace (stejně jako u nabídek).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canManage}
              onClick={() => openModal("contract")}
            >
              Odeslat smlouvu
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canManage}
              onClick={() => openModal("invoice")}
            >
              Odeslat fakturu
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canManage}
              onClick={() => openModal("advance_invoice")}
            >
              Odeslat zálohovou fakturu
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canManage || attachmentOptions.length === 0}
              onClick={() => openModal("job_attachments")}
            >
              Odeslat přílohy
            </Button>
          </div>
          {!canManage ? (
            <p className="text-xs text-muted-foreground">Změny smí provádět vedení zakázky.</p>
          ) : null}

          <div className="border-t border-gray-200 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Historie odeslání ({jobName})
            </p>
            {logsError ? (
              <p className="text-xs text-amber-800">
                Historii nelze načíst (zkontrolujte index Firestore pro řazení podle data).
              </p>
            ) : emailLogs.length === 0 ? (
              <p className="text-xs text-gray-500">Zatím nic nebylo odesláno.</p>
            ) : (
              <ul className="max-h-56 space-y-2 overflow-y-auto text-xs">
                {emailLogs.map((row) => {
                  const attLine = formatLogAttachments(row);
                  return (
                    <li
                      key={row.id}
                      className="rounded-md border border-gray-200 bg-gray-50/80 px-2 py-1.5"
                    >
                      <div className="flex flex-wrap justify-between gap-1 font-medium text-gray-900">
                        <span>
                          {DOCUMENT_EMAIL_TYPE_LABELS[row.type as DocumentEmailType] ??
                            String(row.type ?? "—")}
                        </span>
                        <span
                          className={
                            row.status === "error" ? "text-red-700" : "text-emerald-700"
                          }
                        >
                          {row.status === "error" ? "Chyba" : "Odesláno"}
                        </span>
                      </div>
                      <div className="text-gray-600">
                        {row.to ?? "—"} · {formatLogDate(row)}
                      </div>
                      {row.sentByEmail ? (
                        <div className="text-[10px] text-gray-500">
                          Odeslal: {row.sentByEmail}
                        </div>
                      ) : row.sentByUid ? (
                        <div className="text-[10px] text-gray-500">
                          Odeslal (UID): {String(row.sentByUid).slice(0, 8)}…
                        </div>
                      ) : null}
                      {Array.isArray(row.cc) && row.cc.length > 0 ? (
                        <div className="break-all text-[10px] text-gray-500">
                          Kopie (CC): {row.cc.join(", ")}
                        </div>
                      ) : null}
                      {Array.isArray(row.offerCopyTo) && row.offerCopyTo.length > 0 ? (
                        <div className="break-all text-[10px] text-gray-500">
                          Kopie nabídek (
                          {row.offerCopyMode
                            ? INQUIRY_OFFER_COPY_MODE_LABELS[row.offerCopyMode]
                            : "BCC"}
                          ): {row.offerCopyTo.join(", ")}
                        </div>
                      ) : null}
                      {row.mainDocumentFilename ? (
                        <div className="break-all text-[10px] text-gray-500">
                          Hlavní dokument: {row.mainDocumentFilename}
                        </div>
                      ) : null}
                      {attLine ? (
                        <div className="break-all text-[10px] text-gray-500">{attLine}</div>
                      ) : null}
                      {row.status === "error" && row.errorMessage ? (
                        <div className="text-[10px] text-red-700">{row.errorMessage}</div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Odeslat: {DOCUMENT_EMAIL_TYPE_LABELS[modalType]}
            </DialogTitle>
            <DialogDescription>
              Vyberte hlavní doklad a další přílohy. PDF hlavního dokladu vznikne na serveru. Při
              chybě načtení přílohy se e-mail neodešle.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="doc-email-to">Komu</Label>
              <Input
                id="doc-email-to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="zakaznik@email.cz"
                className="bg-white"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-email-cc">Kopie (CC), volitelné</Label>
              <Input
                id="doc-email-cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="více adres oddělte čárkou"
                className="bg-white"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-email-subject">Předmět</Label>
              <Input
                id="doc-email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="bg-white"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-email-body">Text e-mailu</Label>
              <Textarea
                id="doc-email-body"
                value={bodyPlain}
                onChange={(e) => setBodyPlain(e.target.value)}
                rows={8}
                className="bg-white font-mono text-xs"
              />
            </div>

            {(supportsMainDocument || attachmentOptions.length > 0) && (
              <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50/80 p-3">
                <p className="text-xs font-semibold text-gray-800">Přílohy e-mailu</p>
                {supportsMainDocument && mainDocumentLabel ? (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="doc-email-main"
                      checked={includeMainDocument}
                      onCheckedChange={(v) => setIncludeMainDocument(v === true)}
                      className="mt-0.5 shrink-0"
                    />
                    <Label
                      htmlFor="doc-email-main"
                      className="min-w-0 flex-1 cursor-pointer text-xs font-normal leading-snug"
                    >
                      <span className="block break-words font-medium">{mainDocumentLabel}</span>
                      <span className="text-gray-500">Hlavní doklad — PDF ze serveru</span>
                    </Label>
                  </div>
                ) : null}
                {attachmentOptions.length === 0 ? (
                  <p className="text-[11px] text-gray-500">
                    K zakázce nejsou další soubory k přiložení.
                  </p>
                ) : (
                  <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
                    {attachmentOptions.map((opt) => {
                      const checked = selectedAttachmentIds.has(opt.id);
                      const isMainContractDup =
                        supportsMainDocument &&
                        includeMainDocument &&
                        modalType === "contract" &&
                        opt.kind === "work_contract_pdf" &&
                        contractId &&
                        opt.sourceId === contractId;
                      if (isMainContractDup) return null;
                      return (
                        <li
                          key={opt.id}
                          className="flex items-start gap-2 rounded border border-gray-100 bg-white px-2 py-1.5"
                        >
                          <Checkbox
                            id={`att-${opt.id}`}
                            checked={checked}
                            onCheckedChange={(v) => toggleAttachment(opt.id, v === true)}
                            className="mt-0.5 shrink-0"
                          />
                          <Label
                            htmlFor={`att-${opt.id}`}
                            className="min-w-0 flex-1 cursor-pointer text-xs font-normal"
                          >
                            <span className="block break-all font-medium text-gray-900">
                              {opt.filename}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-gray-500">
                              {opt.fileType} · {formatAttachmentSizeBytes(opt.sizeBytes)} ·{" "}
                              {opt.sourceLabel}
                            </span>
                          </Label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={sending} onClick={() => void handleSend()}>
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Odesílám…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Odeslat
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
