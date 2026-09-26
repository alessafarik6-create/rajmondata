"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Sparkles } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import {
  EMAIL_OVERHEAD_EXPENSE_CATEGORIES,
  EMAIL_OVERHEAD_EXPENSE_LABELS,
  type EmailDocumentAssignmentTarget,
  type EmailOverheadExpenseCategory,
} from "@/lib/email-mailbox/email-document-assignment";
import {
  EMAIL_COMPANY_DOC_TYPES,
  EMAIL_COMPANY_DOC_TYPE_LABELS,
  EMAIL_JOB_ATTACHMENT_ROLES,
  EMAIL_JOB_ATTACHMENT_ROLE_LABELS,
  EMAIL_OVERHEAD_DOC_TYPES,
  EMAIL_OVERHEAD_DOC_TYPE_LABELS,
  jobRoleCreatesAccountingDocument,
  companyDocTypeCreatesAccounting,
  type EmailCompanyDocType,
  type EmailJobAttachmentRole,
  type EmailOverheadDocType,
} from "@/lib/email-mailbox/email-attachment-classification";
import { attachmentKindLabel } from "@/lib/email-mailbox/attachment-meta";
import { useEmailJobSearch } from "@/hooks/use-email-job-search";
import { useToast } from "@/hooks/use-toast";
import type { DocumentCostCategoryKey } from "@/lib/ai/document-extraction-types";

type AnalysisPayload = {
  formPatch?: {
    number?: string;
    entityName?: string;
    amount?: string;
    currency?: "CZK" | "EUR";
    vat?: string;
    date?: string;
    description?: string;
    costCategory?: DocumentCostCategoryKey;
    dueDate?: string;
    requiresPayment?: boolean;
    paymentMethod?: string;
  };
  suggestedJobs?: { id: string; name: string; customerName?: string | null; score?: number }[];
  duplicateCandidates?: { id: string; number?: string | null; entityName?: string | null; date?: string | null }[];
  supplierMatch?: { found?: boolean; name?: string | null; ico?: string | null };
  confidence?: number;
  suggestedContentKind?: string | null;
  suggestedJobRole?: EmailJobAttachmentRole | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  messageId: string;
  attachment: EmailMessageAttachmentMeta;
  getToken: () => Promise<string>;
  canWriteDocuments: boolean;
  canWriteEmail: boolean;
  suggestedJobIdFromEmail?: string | null;
  onSaved?: (payload: {
    documentId: string | null;
    assignmentLabel: string;
    openHref?: string | null;
  }) => void;
};

function isDocLike(att: EmailMessageAttachmentMeta): boolean {
  const m = att.contentType.toLowerCase();
  const fn = att.filename.toLowerCase();
  return m.startsWith("image/") || m.includes("pdf") || fn.endsWith(".pdf");
}

export function EmailDocumentFromAttachmentDialog(props: Props) {
  return <EmailAssignAttachmentDialog {...props} />;
}

export function EmailAssignAttachmentDialog(props: Props) {
  const { toast } = useToast();
  const att = props.attachment;
  const isClassified = Boolean(att.emailPlacement?.target || att.documentAssignmentLabel);

  const [target, setTarget] = useState<EmailDocumentAssignmentTarget>(
    att.emailPlacement?.target ?? "pending"
  );
  const [overheadCategory, setOverheadCategory] = useState<EmailOverheadExpenseCategory>(
    (att.emailPlacement?.overheadCategory as EmailOverheadExpenseCategory) ?? "other"
  );
  const [overheadDocType, setOverheadDocType] = useState<EmailOverheadDocType>(
    att.emailPlacement?.overheadDocType ?? "received_invoice"
  );
  const [companyDocType, setCompanyDocType] = useState<EmailCompanyDocType>(
    att.emailPlacement?.companyDocType ?? "other"
  );
  const [jobRole, setJobRole] = useState<EmailJobAttachmentRole>(
    att.emailPlacement?.jobAttachmentRole ?? "other"
  );
  const [jobQuery, setJobQuery] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(att.emailPlacement?.jobId ?? "");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(
    props.attachment.aiDocumentAnalysisId ?? null
  );
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [aiHint, setAiHint] = useState<string | null>(null);

  const [number, setNumber] = useState("");
  const [entityName, setEntityName] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [taxDate, setTaxDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [variableSymbol, setVariableSymbol] = useState("");
  const [supplierIco, setSupplierIco] = useState("");
  const [supplierDic, setSupplierDic] = useState("");
  const [amountNet, setAmountNet] = useState("");
  const [vatAmount, setVatAmount] = useState("");
  const [amountGross, setAmountGross] = useState("");
  const [vatRate, setVatRate] = useState("21");

  const { jobs, loading: jobsLoading } = useEmailJobSearch({
    companyId: props.companyId,
    enabled: props.open && target === "job",
    query: jobQuery,
    getToken: props.getToken,
  });

  const selectedJob = jobs.find((j) => j.id === selectedJobId);

  const needsAccountingFields = useMemo(() => {
    if (target === "overhead") return true;
    if (target === "pending") return true;
    if (target === "company") return companyDocTypeCreatesAccounting(companyDocType);
    if (target === "job") return jobRoleCreatesAccountingDocument(jobRole);
    return false;
  }, [target, jobRole, companyDocType]);

  useEffect(() => {
    if (!props.open) return;
    setTarget(att.emailPlacement?.target ?? "pending");
    setJobRole(att.emailPlacement?.jobAttachmentRole ?? "other");
    setSelectedJobId(att.emailPlacement?.jobId ?? "");
    setJobQuery("");
    setAnalysis(null);
    setAiHint(null);
    setAnalysisId(att.aiDocumentAnalysisId ?? null);
  }, [props.open, att.id, att.emailPlacement, att.aiDocumentAnalysisId]);

  useEffect(() => {
    if (!props.open) return;
    const suggested = props.suggestedJobIdFromEmail?.trim();
    if (suggested && target === "job" && !selectedJobId) {
      setSelectedJobId(suggested);
    }
  }, [props.open, props.suggestedJobIdFromEmail, target, selectedJobId]);

  function applyAnalysisPayload(payload: AnalysisPayload) {
    const patch = payload.formPatch;
    if (patch) {
      setNumber(patch.number ?? "");
      setEntityName(patch.entityName ?? "");
      setDescription(patch.description ?? "");
      setDate(patch.date ?? new Date().toISOString().slice(0, 10));
      setDueDate(patch.dueDate ?? "");
      setVatRate(patch.vat ?? "21");
      const net = Number(patch.amount) || 0;
      const rate = Number(patch.vat) || 0;
      const vat = net * (rate / 100);
      setAmountNet(net ? String(net) : "");
      setVatAmount(String(Math.round(vat * 100) / 100));
      setAmountGross(String(Math.round((net + vat) * 100) / 100));
      if (payload.supplierMatch?.ico) setSupplierIco(payload.supplierMatch.ico);
    }

    const role = payload.suggestedJobRole;
    const kind = payload.suggestedContentKind;
    if (kind === "DRAWING" || kind === "PROJECT_DOCUMENT") {
      setAiHint("AI doporučuje: pravděpodobně výkres / projektová dokumentace → Zakázka");
      setJobRole("drawing");
    } else if (kind === "CONTRACT") {
      setAiHint("AI doporučuje: pravděpodobně smlouva");
      setJobRole("contract");
    } else if (role === "invoice" || kind === "ACCOUNTING_DOCUMENT") {
      setAiHint("AI doporučuje: pravděpodobně faktura — zkontrolujte cíl zařazení");
      setJobRole("invoice");
    }

    const topJob = payload.suggestedJobs?.[0];
    if (topJob?.id && !selectedJobId) {
      setSelectedJobId(topJob.id);
    }
  }

  async function runAnalyze() {
    if (!props.canWriteEmail || !isDocLike(att)) return;
    setAnalyzing(true);
    try {
      const token = await props.getToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages/${props.messageId}/attachments/analyze-attachment?companyId=${encodeURIComponent(props.companyId)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyId: props.companyId,
            attachmentId: att.id,
          }),
        }
      );
      const data = (await res.json()) as AnalysisPayload & {
        ok?: boolean;
        error?: string;
        analysisId?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Analýza selhala.");
      }
      if (data.analysisId) setAnalysisId(data.analysisId);
      setAnalysis(data);
      applyAnalysisPayload(data);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "AI analýza",
        description: e instanceof Error ? e.message : "Chyba.",
      });
    } finally {
      setAnalyzing(false);
    }
  }

  async function save() {
    if (!props.canWriteEmail) return;
    if (needsAccountingFields && !props.canWriteDocuments) {
      toast({
        variant: "destructive",
        title: "Oprávnění",
        description: "Účetní doklad vyžaduje oprávnění k zápisu v modulu Doklady.",
      });
      return;
    }
    if (target === "job" && !selectedJobId) {
      toast({ variant: "destructive", title: "Vyberte zakázku." });
      return;
    }
    if (needsAccountingFields && (!number.trim() || !entityName.trim())) {
      toast({ variant: "destructive", title: "Vyplňte údaje dokladu." });
      return;
    }

    setSaving(true);
    try {
      const token = await props.getToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages/${props.messageId}/attachments/create-document-from-attachment?companyId=${encodeURIComponent(props.companyId)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyId: props.companyId,
            attachmentId: att.id,
            analysisId,
            assignmentTarget: target,
            updateExisting: true,
            jobId: target === "job" ? selectedJobId : null,
            jobName: selectedJob?.label ?? null,
            jobAttachmentRole: target === "job" ? jobRole : null,
            companyDocType: target === "company" ? companyDocType : null,
            overheadDocType: target === "overhead" ? overheadDocType : null,
            overheadExpenseCategory: target === "overhead" ? overheadCategory : null,
            form: {
              number: needsAccountingFields ? number : att.filename,
              entityName: needsAccountingFields ? entityName : att.filename,
              description,
              date,
              taxDate,
              dueDate,
              variableSymbol,
              supplierIco,
              supplierDic,
              amountNet: Number(amountNet) || 0,
              vatAmount: Number(vatAmount) || 0,
              amountGross: Number(amountGross) || 0,
              vatRate: Number(vatRate) || 0,
              currency: analysis?.formPatch?.currency ?? "CZK",
              costCategory: "other",
              requiresPayment: analysis?.formPatch?.requiresPayment,
              paymentMethod: analysis?.formPatch?.paymentMethod,
            },
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Uložení se nezdařilo.");
      }
      toast({ title: "Příloha zařazena", description: data.assignmentLabel ?? "" });
      props.onSaved?.({
        documentId: data.documentId ?? null,
        assignmentLabel: String(data.assignmentLabel ?? ""),
        openHref: data.openHref ?? null,
      });
      props.onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Zařazení přílohy",
        description: e instanceof Error ? e.message : "Chyba.",
      });
    } finally {
      setSaving(false);
    }
  }

  const targetOptions = useMemo(
    () =>
      [
        { value: "job", label: "Zakázka" },
        { value: "overhead", label: "Režie firmy" },
        { value: "company", label: "Firemní doklady" },
        { value: "pending", label: "Nezařazené" },
      ] as const,
    []
  );

  const kindLabel = attachmentKindLabel(att.contentType, att.filename);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isClassified ? "Změnit zařazení přílohy" : "Zařadit přílohu"}</DialogTitle>
          <DialogDescription>
            {att.filename} · {kindLabel}
          </DialogDescription>
        </DialogHeader>

        {aiHint ? (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>AI doporučení</AlertTitle>
            <AlertDescription>{aiHint}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3 text-sm">
          <div>
            <Label className="mb-2 block">Kam chcete přílohu zařadit?</Label>
            <RadioGroup
              value={target}
              onValueChange={(v) => setTarget(v as EmailDocumentAssignmentTarget)}
              className="space-y-2"
            >
              {targetOptions.map((o) => (
                <div key={o.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={o.value} id={`email-att-target-${o.value}`} />
                  <Label htmlFor={`email-att-target-${o.value}`} className="font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {target === "job" ? (
            <>
              <div className="grid gap-1">
                <Label>Hledat zakázku (číslo, název, zákazník, adresa)</Label>
                <Input value={jobQuery} onChange={(e) => setJobQuery(e.target.value)} />
                <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                  <SelectTrigger>
                    <SelectValue placeholder={jobsLoading ? "Načítám…" : "Vyberte zakázku"} />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.label || j.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedJob ? (
                  <p className="text-xs text-muted-foreground">
                    Vybraná zakázka: {selectedJob.label}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-1">
                <Label>Typ přílohy</Label>
                <Select value={jobRole} onValueChange={(v) => setJobRole(v as EmailJobAttachmentRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMAIL_JOB_ATTACHMENT_ROLES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {EMAIL_JOB_ATTACHMENT_ROLE_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          {target === "overhead" ? (
            <>
              <div className="grid gap-1">
                <Label>Typ</Label>
                <Select
                  value={overheadDocType}
                  onValueChange={(v) => setOverheadDocType(v as EmailOverheadDocType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMAIL_OVERHEAD_DOC_TYPES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {EMAIL_OVERHEAD_DOC_TYPE_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label>Kategorie režie</Label>
                <Select
                  value={overheadCategory}
                  onValueChange={(v) => setOverheadCategory(v as EmailOverheadExpenseCategory)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMAIL_OVERHEAD_EXPENSE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {EMAIL_OVERHEAD_EXPENSE_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          {target === "company" ? (
            <div className="grid gap-1">
              <Label>Typ firemního dokumentu</Label>
              <Select
                value={companyDocType}
                onValueChange={(v) => setCompanyDocType(v as EmailCompanyDocType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMAIL_COMPANY_DOC_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {EMAIL_COMPANY_DOC_TYPE_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {needsAccountingFields ? (
            <>
              <div className="grid gap-1">
                <Label>Dodavatel</Label>
                <Input value={entityName} onChange={(e) => setEntityName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label>Číslo dokladu</Label>
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label>Vystaveno</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="grid gap-1">
                  <Label>Bez DPH</Label>
                  <Input value={amountNet} onChange={(e) => setAmountNet(e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label>DPH</Label>
                  <Input value={vatAmount} onChange={(e) => setVatAmount(e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label>S DPH</Label>
                  <Input value={amountGross} onChange={(e) => setAmountGross(e.target.value)} />
                </div>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
          {isDocLike(att) ? (
            <Button
              type="button"
              variant="outline"
              disabled={analyzing}
              onClick={() => void runAnalyze()}
              className="sm:mr-auto"
            >
              {analyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-1" /> AI doporučení
                </>
              )}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            type="button"
            disabled={saving || !props.canWriteEmail || analyzing}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit zařazení"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
