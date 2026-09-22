"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUser } from "@/firebase";
import type { ChatAttachmentMeta } from "@/lib/company-chat-types";
import type { DocumentAiAnalysisResult } from "@/components/documents/document-ai-scan-section";
import { ChatDocumentFromAttachmentDialog } from "@/components/chat/chat-document-from-attachment-dialog";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";

function isDocLikeAttachment(att: ChatAttachmentMeta): boolean {
  const m = att.mimeType.toLowerCase();
  return m.startsWith("image/") || m.includes("pdf");
}

function formatMoney(n: number | undefined, currency = "CZK"): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v.toLocaleString("cs-CZ")} ${currency === "EUR" ? "EUR" : "Kč"}`;
}

export function ChatAttachmentDocumentPanel(props: {
  companyId: string;
  messageId: string;
  attachment: ChatAttachmentMeta;
  conversationId: string;
  onAttachmentPatched?: () => void;
}) {
  const { user } = useUser();
  const docsAccess = usePortalModuleAccess("documents");
  const att = props.attachment;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<DocumentAiAnalysisResult | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(
    att.aiDocumentAnalysisId ?? null
  );
  const [status, setStatus] = useState(att.analysisStatus ?? "idle");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<"job" | "overhead" | "pending">("pending");

  const runAnalyze = useCallback(async () => {
    if (!user || !isDocLikeAttachment(att)) return;
    if (
      att.aiDocumentAnalysisId &&
      (att.analysisStatus === "recognized" ||
        att.analysisStatus === "needs_review" ||
        att.analysisStatus === "saved")
    ) {
      setAnalysisId(att.aiDocumentAnalysisId);
      setStatus(att.analysisStatus);
      setDialogOpen(true);
      return;
    }
    setLoading(true);
    setError(null);
    setStatus("analyzing");
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/chat/analyze-attachment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: props.companyId,
          messageId: props.messageId,
          attachmentId: att.id,
        }),
      });
      const data = (await res.json()) as DocumentAiAnalysisResult & {
        ok?: boolean;
        error?: string;
        analysisId?: string;
        analysisStatus?: string;
        cached?: boolean;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Analýza se nezdařila.");
      }
      if (!data.readable) {
        setStatus("error");
        setError(data.unreadableReason ?? "Doklad se nepodařilo přečíst.");
        return;
      }
      setAnalysis(data);
      setAnalysisId(data.analysisId ?? att.aiDocumentAnalysisId ?? null);
      setStatus(
        (data.analysisStatus as typeof status) ??
          (data.confidence >= 0.75 ? "recognized" : "needs_review")
      );
      props.onAttachmentPatched?.();
      setDialogOpen(true);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Chyba analýzy.");
    } finally {
      setLoading(false);
    }
  }, [user, att, props]);

  if (!isDocLikeAttachment(att)) return null;

  if (att.linkedDocumentId) {
    return (
      <div className="mt-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-100">
        Uloženo jako doklad{" "}
        {docsAccess.canRead ? (
          <Link
            href={`/portal/documents?highlight=${encodeURIComponent(att.linkedDocumentId)}`}
            className="underline font-semibold"
          >
            otevřít
          </Link>
        ) : null}
      </div>
    );
  }

  const preview = analysis?.formPatch;
  const showCard =
    status === "recognized" || status === "needs_review" || status === "saved";

  return (
    <div className="mt-2 space-y-2">
      {!showCard ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 text-xs gap-1.5"
          disabled={loading || status === "analyzing"}
          onClick={() => void runAnalyze()}
        >
          {loading || status === "analyzing" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {status === "analyzing" ? "Analyzuji…" : "Rozpoznat doklad"}
        </Button>
      ) : null}

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

      {showCard && preview ? (
        <div
          className={cn(
            "rounded-lg border px-2.5 py-2 text-[11px] leading-snug",
            "border-orange-500/35 bg-orange-500/10 text-orange-50 max-w-full"
          )}
        >
          <p className="font-semibold flex items-center gap-1">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            Rozpoznaný doklad
            {status === "needs_review" ? (
              <span className="text-amber-200 font-normal"> · vyžaduje kontrolu</span>
            ) : null}
          </p>
          <p className="truncate mt-0.5">{preview.entityName || "—"}</p>
          <p className="text-orange-100/90">
            {formatMoney(Number(preview.amount), preview.currency)} · {preview.date || "—"}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-[10px] px-2 bg-orange-600 hover:bg-orange-700"
              disabled={!docsAccess.canWrite}
              onClick={() => {
                setDialogTarget("job");
                setDialogOpen(true);
              }}
            >
              Zakázka
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-[10px] px-2"
              disabled={!docsAccess.canWrite}
              onClick={() => {
                setDialogTarget("overhead");
                setDialogOpen(true);
              }}
            >
              Režie
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] px-2 text-orange-100"
              onClick={() => {
                setDialogTarget("pending");
                setDialogOpen(true);
              }}
            >
              Detail
            </Button>
          </div>
          {!docsAccess.canWrite ? (
            <p className="text-[10px] text-orange-200/70 mt-1">Uložení vyžaduje oprávnění k dokladům.</p>
          ) : null}
        </div>
      ) : null}

      <ChatDocumentFromAttachmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={props.companyId}
        messageId={props.messageId}
        attachment={att}
        analysisId={analysisId}
        initialAnalysis={analysis}
        canWriteDocuments={docsAccess.canWrite}
        defaultTarget={dialogTarget}
        onSaved={() => {
          setStatus("saved");
          props.onAttachmentPatched?.();
        }}
      />
    </div>
  );
}
