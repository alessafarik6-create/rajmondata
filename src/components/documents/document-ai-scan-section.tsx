"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, FileUp, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import type {
  DocumentAiFilledFields,
  DocumentAiFormPatch,
  DocumentAiLowConfidenceFields,
} from "@/lib/ai/document-extraction-types";

const ACCEPT =
  "image/jpeg,image/png,image/webp,application/pdf,.pdf,.jpg,.jpeg,.png,.webp";

export type DocumentAiAnalysisResult = {
  ok?: boolean;
  readable: boolean;
  unreadableReason: string | null;
  formPatch: DocumentAiFormPatch;
  direction: "received" | "issued";
  warnings: string[];
  confidence: number;
  filledFields: DocumentAiFilledFields;
  lowConfidenceFields: DocumentAiLowConfidenceFields;
  duplicateCandidates: Array<{
    id: string;
    number: string | null;
    entityName: string | null;
    amountNet: number | null;
    date: string | null;
  }>;
  suggestedJobs: Array<{
    id: string;
    name: string;
    customerName: string | null;
    score: number;
  }>;
  supplierMatch: { found: boolean; name: string | null; ico: string | null };
  model: string;
  searchableText?: string;
  aiMeta: {
    analysedByAi: true;
    aiModel: string;
    aiConfidence: number;
    aiWarnings: string[];
  };
};

type Props = {
  companyId: string;
  onFileSelected: (file: File | null) => void;
  onAnalysisComplete: (result: DocumentAiAnalysisResult) => void;
  onAnalysisReset: () => void;
  previewUrl: string | null;
  onPreviewUrlChange: (url: string | null) => void;
  analyzed: boolean;
};

function mapUserError(status: number, msg?: string): string {
  if (msg?.trim()) return msg.trim();
  if (status === 503) return "OpenAI API není nakonfigurováno.";
  if (status === 413) return "Soubor je příliš velký pro AI analýzu.";
  if (status === 429) return "Byl překročen limit OpenAI API.";
  return "Analýza dokladu se nezdařila. Zkuste to znovu.";
}

export function DocumentAiScanSection({
  companyId,
  onFileSelected,
  onAnalysisComplete,
  onAnalysisReset,
  previewUrl,
  onPreviewUrlChange,
  analyzed,
}: Props) {
  const { user } = useUser();
  const { toast } = useToast();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [localFileName, setLocalFileName] = useState<string | null>(null);

  const analyzeFile = useCallback(
    async (file: File) => {
      if (!user || !companyId) return;
      setLoading(true);
      onAnalysisReset();
      try {
        const token = await user.getIdToken();
        const fd = new FormData();
        fd.append("companyId", companyId);
        fd.append("file", file);
        const res = await fetch("/api/company/documents/analyze", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const data = (await res.json()) as DocumentAiAnalysisResult & {
          error?: string;
        };
        if (!res.ok || data.ok === false) {
          throw new Error(mapUserError(res.status, data.error));
        }
        if (!data.readable) {
          toast({
            variant: "destructive",
            title: "Doklad se nepodařilo přečíst",
            description:
              data.unreadableReason ??
              "Vyfoťte prosím doklad znovu — lepší světlo, bez rozmazání.",
          });
          return;
        }
        onAnalysisComplete({ ...data, ok: true });
        toast({
          title: "Doklad načten pomocí AI",
          description: "Zkontrolujte předvyplněné údaje před uložením.",
        });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "AI analýza",
          description:
            e instanceof Error ? e.message : "Analýza dokladu se nezdařila.",
        });
      } finally {
        setLoading(false);
      }
    },
    [user, companyId, onAnalysisComplete, onAnalysisReset, toast]
  );

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setLocalFileName(file.name);
      onFileSelected(file);
      const url = URL.createObjectURL(file);
      onPreviewUrlChange(url);
      await analyzeFile(file);
    },
    [analyzeFile, onFileSelected, onPreviewUrlChange]
  );

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const previewIsPdf = useMemo(
    () => localFileName?.toLowerCase().endsWith(".pdf") ?? false,
    [localFileName]
  );

  return (
    <div className="space-y-3 sm:col-span-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="default"
          className="min-h-11 gap-2 bg-violet-600 hover:bg-violet-700 touch-manipulation"
          disabled={loading}
          onClick={() => cameraInputRef.current?.click()}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          {loading ? "AI načítá doklad…" : "Vyfotit doklad"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 gap-2 touch-manipulation"
          disabled={loading}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp className="h-4 w-4" />
          Nahrát PDF / soubor
        </Button>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          void handleFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          void handleFile(f);
          e.target.value = "";
        }}
      />

      {analyzed ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
          <Sparkles className="h-4 w-4 text-emerald-700" />
          <AlertTitle>Doklad načten pomocí AI</AlertTitle>
          <AlertDescription>
            Zkontrolujte údaje a teprve potom uložte doklad.
          </AlertDescription>
        </Alert>
      ) : null}

      {localFileName ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Soubor: {localFileName}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2"
            disabled={loading}
            onClick={() => cameraInputRef.current?.click()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Vyfotit znovu
          </Button>
          {previewUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => setShowPreview((v) => !v)}
            >
              {showPreview ? "Skrýt originál" : "Zobrazit originál"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showPreview && previewUrl ? (
        <div className="overflow-hidden rounded-lg border bg-muted/30">
          {previewIsPdf ? (
            <iframe
              src={previewUrl}
              title="Náhled PDF dokladu"
              className="h-[min(50vh,320px)] w-full"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Náhled dokladu"
              className="max-h-[min(50vh,320px)] w-full object-contain"
            />
          )}
        </div>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-violet-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          AI načítá doklad…
        </p>
      ) : null}
    </div>
  );
}

export function DocumentAiWarningsPanel(props: {
  warnings: string[];
  duplicateCandidates: DocumentAiAnalysisResult["duplicateCandidates"];
  suggestedJobs: DocumentAiAnalysisResult["suggestedJobs"];
  supplierMatch: DocumentAiAnalysisResult["supplierMatch"];
  onApplySuggestedJob?: (jobId: string) => void;
}) {
  if (
    props.warnings.length === 0 &&
    props.duplicateCandidates.length === 0 &&
    props.suggestedJobs.length === 0 &&
    props.supplierMatch.found
  ) {
    return null;
  }

  return (
    <div className="space-y-2 sm:col-span-2">
      {props.warnings.map((w) => (
        <Alert key={w} className="border-amber-200 bg-amber-50 py-2">
          <AlertDescription className="text-sm text-amber-950">{w}</AlertDescription>
        </Alert>
      ))}
      {!props.supplierMatch.found && props.supplierMatch.name ? (
        <p className="text-xs text-muted-foreground">
          Dodavatel „{props.supplierMatch.name}“ nebyl nalezen v CRM.
        </p>
      ) : null}
      {props.suggestedJobs.length > 0 ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2">
          <p className="text-xs font-medium text-violet-900">Pravděpodobná zakázka</p>
          <ul className="mt-1 space-y-1">
            {props.suggestedJobs.slice(0, 3).map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2 text-xs">
                <span>
                  {j.name}
                  {j.customerName ? ` · ${j.customerName}` : ""}
                </span>
                {props.onApplySuggestedJob ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => props.onApplySuggestedJob?.(j.id)}
                  >
                    Vybrat
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
