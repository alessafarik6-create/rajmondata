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
  EMAIL_JOB_COST_CATEGORIES,
  EMAIL_JOB_COST_LABELS,
  EMAIL_OVERHEAD_EXPENSE_CATEGORIES,
  EMAIL_OVERHEAD_EXPENSE_LABELS,
  type EmailDocumentAssignmentTarget,
  type EmailOverheadExpenseCategory,
} from "@/lib/email-mailbox/email-document-assignment";
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
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  messageId: string;
  attachment: EmailMessageAttachmentMeta;
  getToken: () => Promise<string>;
  canWriteDocuments: boolean;
  /** Návrh zakázky z e-mailu — ne automatické přiřazení dokladu. */
  suggestedJobIdFromEmail?: string | null;
  onSaved?: (documentId: string, assignmentLabel: string) => void;
};

function isDocLike(att: EmailMessageAttachmentMeta): boolean {
  const m = att.contentType.toLowerCase();
  const fn = att.filename.toLowerCase();
  return m.startsWith("image/") || m.includes("pdf") || fn.endsWith(".pdf");
}

export function EmailDocumentFromAttachmentDialog(props: Props) {
  const { toast } = useToast();
  const [target, setTarget] = useState<EmailDocumentAssignmentTarget>("pending");
  const [overheadCategory, setOverheadCategory] = useState<EmailOverheadExpenseCategory>("other");
  const [jobCostCategory, setJobCostCategory] = useState<string>("material");
  const [jobQuery, setJobQuery] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
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

  useEffect(() => {
    if (!props.open) return;
    setTarget("pending");
    setOverheadCategory("other");
    setJobCostCategory("material");
    setSelectedJobId("");
    setJobQuery("");
    setAnalysis(null);
    setAiHint(null);
    setAnalysisId(props.attachment.aiDocumentAnalysisId ?? null);
  }, [props.open, props.attachment.id, props.attachment.aiDocumentAnalysisId]);

  useEffect(() => {
    if (!props.open) return;
    const suggested = props.suggestedJobIdFromEmail?.trim();
    if (suggested && target === "job" && !selectedJobId) {
      setSelectedJobId(suggested);
    }
  }, [props.open, props.suggestedJobIdFromEmail, target, selectedJobId]);

  function applyAnalysisPayload(payload: AnalysisPayload) {
    const patch = payload.formPatch;
    if (!patch) return;
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
    if (patch.costCategory) {
      setJobCostCategory(patch.costCategory);
    }
    if (payload.supplierMatch?.ico) setSupplierIco(payload.supplierMatch.ico);

    const topJob = payload.suggestedJobs?.[0];
    if (topJob?.id) {
      setAiHint(
        `RAJMONDATA AI doporučuje: Zakázka → ${topJob.name}${
          topJob.customerName ? ` (${topJob.customerName})` : ""
        }`
      );
      if (target === "pending") setTarget("job");
      if (!selectedJobId) setSelectedJobId(topJob.id);
    } else if (patch.costCategory === "other" || patch.costCategory === "transport") {
      setAiHint("RAJMONDATA AI doporučuje: Režie → Ostatní režie");
    }
  }

  async function runAnalyze() {
    if (!props.canWriteDocuments || !isDocLike(props.attachment)) return;
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
            attachmentId: props.attachment.id,
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

  useEffect(() => {
    if (!props.open || !isDocLike(props.attachment)) return;
    if (props.attachment.analysisStatus === "saved") return;
    void runAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.attachment.id]);

  async function save() {
    if (!props.canWriteDocuments) return;
    if (target === "job" && !selectedJobId) {
      toast({ variant: "destructive", title: "Vyberte zakázku." });
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
            attachmentId: props.attachment.id,
            analysisId,
            assignmentTarget: target,
            jobId: target === "job" ? selectedJobId : null,
            jobName: selectedJob?.label ?? null,
            overheadExpenseCategory: target === "overhead" ? overheadCategory : null,
            form: {
              number,
              entityName,
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
              costCategory:
                target === "job"
                  ? jobCostCategory === "services"
                    ? "other"
                    : jobCostCategory
                  : "other",
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
      if (data.duplicate) {
        toast({ title: "Doklad již zařazen", description: "Otevřete existující záznam." });
        props.onSaved?.(String(data.documentId), props.attachment.documentAssignmentLabel ?? "");
        props.onOpenChange(false);
        return;
      }
      toast({ title: "Doklad uložen", description: data.assignmentLabel ?? "" });
      props.onSaved?.(String(data.documentId), String(data.assignmentLabel ?? ""));
      props.onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení dokladu",
        description: e instanceof Error ? e.message : "Chyba.",
      });
    } finally {
      setSaving(false);
    }
  }

  const duplicates = analysis?.duplicateCandidates ?? [];

  const targetOptions = useMemo(
    () =>
      [
        { value: "job", label: "K zakázce" },
        { value: "overhead", label: "Režie firmy" },
        { value: "company", label: "Obecný firemní doklad" },
        { value: "pending", label: "Pouze uložit do Dokladů (nezařazený)" },
      ] as const,
    []
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Zařadit doklad z přílohy</DialogTitle>
          <DialogDescription>
            Typ dokladu: Přijatá faktura / účtenka — zkontrolujte údaje před uložením.
          </DialogDescription>
        </DialogHeader>

        {!props.canWriteDocuments ? (
          <Alert>
            <AlertTitle>Jen náhled</AlertTitle>
            <AlertDescription>
              Uložit doklad smí uživatel s oprávněním k zápisu v modulu Doklady.
            </AlertDescription>
          </Alert>
        ) : null}

        {aiHint ? (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>AI doporučení</AlertTitle>
            <AlertDescription>{aiHint}</AlertDescription>
          </Alert>
        ) : null}

        {duplicates.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>Podobný doklad už existuje</AlertTitle>
            <AlertDescription className="text-xs space-y-1">
              {duplicates.slice(0, 3).map((d) => (
                <div key={d.id}>
                  {d.entityName ?? "—"} · {d.number ?? "—"} · {d.date ?? "—"}
                </div>
              ))}
            </AlertDescription>
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
                  <RadioGroupItem value={o.value} id={`email-doc-target-${o.value}`} />
                  <Label htmlFor={`email-doc-target-${o.value}`} className="font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {target === "job" ? (
            <>
              <div className="grid gap-1">
                <Label>Hledat zakázku</Label>
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
              </div>
              <div className="grid gap-1">
                <Label>Kategorie nákladu na zakázce</Label>
                <Select value={jobCostCategory} onValueChange={setJobCostCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMAIL_JOB_COST_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {EMAIL_JOB_COST_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          {target === "overhead" ? (
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
          ) : null}

          <div className="grid gap-1">
            <Label>Dodavatel</Label>
            <Input value={entityName} onChange={(e) => setEntityName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label>IČO</Label>
              <Input value={supplierIco} onChange={(e) => setSupplierIco(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>DIČ</Label>
              <Input value={supplierDic} onChange={(e) => setSupplierDic(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label>Číslo dokladu</Label>
              <Input value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Variabilní symbol</Label>
              <Input value={variableSymbol} onChange={(e) => setVariableSymbol(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1">
              <Label>Vystaveno</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>DUZP</Label>
              <Input type="date" value={taxDate} onChange={(e) => setTaxDate(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Splatnost</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
          <div className="grid gap-1">
            <Label>Poznámka</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
          {isDocLike(props.attachment) ? (
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
                  <Sparkles className="h-4 w-4 mr-1" /> Znovu analyzovat
                </>
              )}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            type="button"
            disabled={
              saving ||
              !props.canWriteDocuments ||
              !number.trim() ||
              !entityName.trim() ||
              analyzing
            }
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit doklad"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
