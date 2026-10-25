"use client";

import React from "react";
import type { ChatAttachmentMeta, ChatMessageDoc } from "@/lib/company-chat-types";
import { ChatAttachmentDocumentPanel } from "@/components/chat/chat-attachment-document-panel";
import { ChatWorkIntentPanel } from "@/components/chat/chat-work-intent-panel";

function isDocLike(att: ChatAttachmentMeta): boolean {
  const m = att.mimeType.toLowerCase();
  return m.startsWith("image/") || m.includes("pdf");
}

export function ChatMessageAiSection(props: {
  companyId: string;
  message: ChatMessageDoc;
  chatBasePath?: "/portal/chat" | "/portal/employee/messages";
  canApplyJobs: boolean;
  canUseDocumentAi: boolean;
  onRefresh?: () => void;
}) {
  const m = props.message;
  const attachments = m.attachments ?? [];
  const docLike = attachments.filter(isDocLike);
  const hasText = Boolean(m.text?.trim() && m.text !== "📎 Příloha");

  if (!props.canUseDocumentAi) return null;
  if (!hasText && docLike.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 rounded-lg border border-border bg-background text-foreground p-2 shadow-sm">
      {docLike.map((att) => (
        <ChatAttachmentDocumentPanel
          key={att.id}
          companyId={props.companyId}
          messageId={m.id}
          attachment={att}
          conversationId={String(m.conversationId ?? "company")}
          chatBasePath={props.chatBasePath}
          onAttachmentPatched={props.onRefresh}
        />
      ))}
      <ChatWorkIntentPanel
        companyId={props.companyId}
        messageId={m.id}
        messageText={m.text ?? ""}
        attachments={attachments}
        attachmentIds={docLike.map((a) => a.id)}
        canAnalyze={props.canUseDocumentAi}
        canApplyJobs={props.canApplyJobs}
        initialAnalysisId={m.aiWorkIntentAnalysisId}
        workIntentStatus={m.workIntentStatus}
        onPatched={props.onRefresh}
      />
    </div>
  );
}
