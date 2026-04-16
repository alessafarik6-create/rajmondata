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
  prepareDocumentEmailPdf: (input: {
    type: DocumentEmailType;
    contractId: string | null;
    invoiceId: string | null;
  }) => Promise<{ filename: string; contentBase64: string }>;
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
  prepareDocumentEmailPdf,
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

  const { data: jobInvoicesRaw = [] } = useCollection(jobInvoicesQuery);

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
  const [sending, setSending] = useState(false);

  const outbound = useMemo(
    () => readDocumentEmailOutbound(companyDoc ?? undefined),
    [companyDoc]
  );

  const buildVars = useCallback(
    (type: DocumentEmailType): DocumentEmailTemplateVars | null => {
      const origin = appOrigin();
      const firm = companyDisplayName.trim() || "Organizace";
      const jmeno = customerName.trim() || "—";
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
        const link = origin ? `${origin}/portal/jobs/${jobId}` : `/portal/jobs/${jobId}`;
        return {
          nazev_firmy: firm,
          jmeno_zakaznika: jmeno,
          cislo_dokladu: num,
          datum,
          castka,
          odkaz_na_dokument: link,
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
      jobBudgetBreakdown,
      jobId,
      latestAdvanceInvoice,
      latestFinalInvoice,
      primaryContract,
    ]
  );

  const openModal = (type: DocumentEmailType) => {
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
    const tpl = getEmailTemplate(outbound, type);
    setModalType(type);
    setTo(String(customerEmail ?? "").trim());
    setCc("");
    setSubject(substituteDocumentEmailVariables(tpl.subject, vars));
    setBodyPlain(substituteDocumentEmailVariables(tpl.body, vars));
    setDocumentUrl(vars.odkaz_na_dokument);
    if (type === "contract") {
      setContractId(primaryContract?.id ?? null);
      setInvoiceId(null);
    } else if (type === "invoice") {
      setContractId(null);
      setInvoiceId(latestFinalInvoice?.id ?? null);
    } else {
      setContractId(null);
      setInvoiceId(latestAdvanceInvoice?.id ?? null);
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
    const html = normalizeEmailBodyToHtml(bodyPlain);
    setSending(true);
    try {
      let pdf: { filename: string; contentBase64: string };
      try {
        pdf = await prepareDocumentEmailPdf({
          type: modalType,
          contractId,
          invoiceId,
        });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "PDF se nepodařilo vytvořit",
          description: e instanceof Error ? e.message : "Neznámá chyba.",
        });
        return;
      }
      const r = await sendJobDocumentEmailFromBrowser({
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
        attachments: [
          {
            filename: pdf.filename,
            contentType: "application/pdf",
            contentBase64: pdf.contentBase64,
          },
        ],
      });
      if (!r.ok) {
        toast({
          variant: "destructive",
          title: "Odeslání se nezdařilo",
          description: r.error,
        });
        return;
      }
      toast({
        title: "Odesláno",
        description: "E-mail včetně PDF přílohy byl odeslán a zapsán do historie.",
      });
      setModalOpen(false);
    } finally {
      setSending(false);
    }
  };

  const jobName =
    job && String(job.name ?? "").trim() ? String(job.name).trim() : "Zakázka";

  return (
    <>
      <Card className="border border-gray-200 bg-white shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-950">
            <Mail className="h-4 w-4 shrink-0 text-gray-600" aria-hidden />
            Odeslání dokumentu e-mailem
          </CardTitle>
          <p className="text-xs text-gray-600">
            Odeslání přes server (Resend) s PDF přílohou dokladu. Historie a kopie dle nastavení
            organizace.
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
                {emailLogs.map((row) => (
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
                      <div className="text-[10px] text-gray-500">Kopie: {row.cc.join(", ")}</div>
                    ) : null}
                    {Array.isArray(row.attachmentFilenames) &&
                    row.attachmentFilenames.length > 0 ? (
                      <div className="text-[10px] text-gray-500">
                        PDF: {row.attachmentFilenames.join(", ")}
                      </div>
                    ) : null}
                    {row.status === "error" && row.errorMessage ? (
                      <div className="text-[10px] text-red-700">{row.errorMessage}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Odeslat: {DOCUMENT_EMAIL_TYPE_LABELS[modalType]}
            </DialogTitle>
            <DialogDescription>
              Před odesláním se vygeneruje PDF příloha. Zkontrolujte příjemce a text — kopie
              organizace se přidají při odeslání dle nastavení.
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
                rows={10}
                className="bg-white font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={sending} onClick={() => void handleSend()}>
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  PDF a odeslání…
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
