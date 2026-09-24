"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import { Loader2 } from "lucide-react";
import { useUser, useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { collection, query, where, orderBy, limit } from "firebase/firestore";
import type { ChatAttachmentMeta } from "@/lib/company-chat-types";
import type { DocumentAiAnalysisResult } from "@/components/documents/document-ai-scan-section";
import { useToast } from "@/hooks/use-toast";
import type { DocumentCostCategoryKey } from "@/lib/ai/document-extraction-types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  messageId: string;
  attachment: ChatAttachmentMeta;
  analysisId: string | null;
  initialAnalysis: DocumentAiAnalysisResult | null;
  canWriteDocuments: boolean;
  onSaved?: (documentId: string) => void;
  defaultTarget?: "job" | "overhead" | "pending";
};

export function ChatDocumentFromAttachmentDialog(props: Props) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<"job" | "overhead" | "pending">(
    props.defaultTarget ?? "pending"
  );
  const [jobId, setJobId] = useState("");
  const [jobQuery, setJobQuery] = useState("");

  const analysis = props.initialAnalysis;
  const patch = analysis?.formPatch;

  const [number, setNumber] = useState("");
  const [entityName, setEntityName] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [amountNet, setAmountNet] = useState("");
  const [vatAmount, setVatAmount] = useState("");
  const [amountGross, setAmountGross] = useState("");
  const [vatRate, setVatRate] = useState("");
  const [costCategory, setCostCategory] = useState<DocumentCostCategoryKey>("other");

  useEffect(() => {
    if (props.open && props.defaultTarget) {
      setTarget(props.defaultTarget);
    }
  }, [props.open, props.defaultTarget]);

  useEffect(() => {
    if (!props.open || !patch) return;
    setNumber(patch.number ?? "");
    setEntityName(patch.entityName ?? "");
    setDescription(patch.description ?? "");
    setDate(patch.date ?? new Date().toISOString().slice(0, 10));
    setAmountNet(patch.amount ?? "");
    setVatRate(patch.vat ?? "21");
    const net = Number(patch.amount) || 0;
    const rate = Number(patch.vat) || 0;
    const vat = net * (rate / 100);
    setVatAmount(String(Math.round(vat * 100) / 100));
    setAmountGross(String(Math.round((net + vat) * 100) / 100));
    setCostCategory(patch.costCategory ?? "other");
  }, [props.open, patch]);

  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !props.companyId) return null;
    return query(
      collection(firestore, "companies", props.companyId, "jobs"),
      orderBy("name"),
      limit(200)
    );
  }, [firestore, props.companyId]);
  const { data: jobsRaw = [] } = useCollection<{ id: string; name?: string; customerName?: string }>(
    jobsQuery
  );

  const jobs = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    const list = jobsRaw ?? [];
    if (!q) return list.slice(0, 40);
    return list
      .filter((j) => {
        const name = String(j.name ?? "").toLowerCase();
        const cust = String(j.customerName ?? "").toLowerCase();
        return name.includes(q) || cust.includes(q) || j.id.toLowerCase().includes(q);
      })
      .slice(0, 40);
  }, [jobsRaw, jobQuery]);

  const selectedJob = jobsRaw?.find((j) => j.id === jobId);

  const duplicates = analysis?.duplicateCandidates ?? [];

  async function save() {
    if (!user || !props.canWriteDocuments) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/chat/create-document-from-attachment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: props.companyId,
          messageId: props.messageId,
          attachmentId: props.attachment.id,
          analysisId: props.analysisId,
          assignmentTarget: target,
          jobId: target === "job" ? jobId : null,
          jobName: selectedJob?.name ?? null,
          form: {
            number,
            entityName,
            description,
            date,
            amountNet: Number(amountNet) || 0,
            vatAmount: Number(vatAmount) || 0,
            amountGross: Number(amountGross) || 0,
            vatRate: Number(vatRate) || 0,
            currency: patch?.currency ?? "CZK",
            costCategory,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Uložení se nezdařilo.");
      }
      toast({
        title: "Doklad uložen",
        description: "Příloha z chatu byla zapsána mezi doklady.",
      });
      props.onSaved?.(String(data.documentId ?? "").trim());
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

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Doklad z chatu</DialogTitle>
          <DialogDescription>
            Zkontrolujte údaje z AI analýzy před uložením.
          </DialogDescription>
        </DialogHeader>

        {!props.canWriteDocuments ? (
          <Alert>
            <AlertTitle>Jen náhled</AlertTitle>
            <AlertDescription>
              Můžete spustit analýzu, ale uložit doklad smí jen uživatel s oprávněním k zápisu
              dokladů.
            </AlertDescription>
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

        <div className="grid gap-3 text-sm">
          <div className="grid gap-1">
            <Label>Dodavatel</Label>
            <Input value={entityName} onChange={(e) => setEntityName(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>Číslo dokladu</Label>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label>Datum</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Kategorie</Label>
              <Select
                value={costCategory}
                onValueChange={(v) => setCostCategory(v as DocumentCostCategoryKey)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="material">Materiál</SelectItem>
                  <SelectItem value="work">Práce</SelectItem>
                  <SelectItem value="transport">Doprava / PHM</SelectItem>
                  <SelectItem value="other">Režie / ostatní</SelectItem>
                </SelectContent>
              </Select>
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
              <Label>Celkem</Label>
              <Input value={amountGross} onChange={(e) => setAmountGross(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>Poznámka</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid gap-1">
            <Label>Cíl</Label>
            <Select
              value={target}
              onValueChange={(v) => setTarget(v as typeof target)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="job">Zakázka</SelectItem>
                <SelectItem value="overhead">Režie firmy</SelectItem>
                <SelectItem value="pending">Nezařazeno</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {target === "job" ? (
            <div className="grid gap-1">
              <Label>Vyhledat zakázku</Label>
              <Input
                placeholder="Název, zákazník…"
                value={jobQuery}
                onChange={(e) => setJobQuery(e.target.value)}
              />
              <Select value={jobId} onValueChange={setJobId}>
                <SelectTrigger>
                  <SelectValue placeholder="Vyberte zakázku" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.name ?? j.id}
                      {j.customerName ? ` · ${j.customerName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Zavřít
          </Button>
          <Button
            type="button"
            disabled={saving || !props.canWriteDocuments || !number.trim() || !entityName.trim()}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit jako doklad"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
