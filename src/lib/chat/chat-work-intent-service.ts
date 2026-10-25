import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { extractPdfTextContent } from "@/lib/ai/document-pdf-text";
import { OpenAiClientError } from "@/lib/ai/openai-client";
import { OPENAI_DOCUMENT_MAX_BYTES } from "@/lib/ai/config";
import type { DocumentAiInputContent } from "@/lib/ai/openai-document-client";
import {
  downloadChatAttachmentBuffer,
  fetchUrlBuffer,
} from "@/lib/chat-attachment-download-server";
import type { ChatAttachmentMeta } from "@/lib/company-chat-types";
import { analyzeChatWorkIntentWithOpenAi } from "@/lib/chat/openai-chat-work-intent-client";
import type {
  ChatWorkIntentAnalysisDoc,
  ChatWorkIntentProposal,
} from "@/lib/chat/chat-work-intent-types";
import {
  enrichProposalCompletion,
  loadCustomersForMatching,
  loadRecentJobs,
  matchCustomerForProposal,
  matchJobsForProposal,
} from "@/lib/chat/chat-work-intent-matching";
import { AI_SETTINGS_DOC_ID } from "@/lib/ai/ai-settings-types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

function isAnalyzableMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return m.startsWith("image/") || m.includes("pdf");
}

async function attachmentToMedia(att: ChatAttachmentMeta): Promise<DocumentAiInputContent | null> {
  let buffer =
    (att.storagePath ? await downloadChatAttachmentBuffer(att.storagePath) : null) ??
    (att.downloadUrl ? await fetchUrlBuffer(att.downloadUrl) : null);
  if (!buffer?.length || buffer.length > OPENAI_DOCUMENT_MAX_BYTES) return null;
  const mime = att.mimeType.toLowerCase().split(";")[0].trim();
  if (mime.startsWith("image/")) {
    return { kind: "image", mimeType: mime, base64: buffer.toString("base64") };
  }
  if (mime.includes("pdf")) {
    const text = await extractPdfTextContent(buffer).catch(() => "");
    if (text.trim().length >= 40) {
      return { kind: "pdf_text", text, fileName: att.fileName };
    }
    return { kind: "pdf", base64: buffer.toString("base64"), fileName: att.fileName };
  }
  return null;
}

export async function isChatWorkIntentEnabledForOrg(
  db: Firestore,
  companyId: string
): Promise<boolean> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("ai_settings")
    .doc(AI_SETTINGS_DOC_ID)
    .get();
  const data = snap.data();
  if (data && data.enabled === false) return false;
  if (data && data.chatWorkIntentAnalysis === false) return false;
  return true;
}

function parseAiProposals(raw: unknown): ChatWorkIntentProposal[] {
  if (!raw || typeof raw !== "object") return [];
  const proposals = (raw as { proposals?: unknown }).proposals;
  if (!Array.isArray(proposals)) return [];
  return proposals
    .map((p, idx) => {
      if (!p || typeof p !== "object") return null;
      const o = p as Record<string, unknown>;
      return {
        proposalId: String(o.proposalId ?? `p${idx + 1}`),
        kind: String(o.kind ?? "unclear") as ChatWorkIntentProposal["kind"],
        confidence: Number(o.confidence ?? 0.5),
        jobTitle: o.jobTitle != null ? String(o.jobTitle) : null,
        customerName: o.customerName != null ? String(o.customerName) : null,
        companyName: o.companyName != null ? String(o.companyName) : null,
        phone: o.phone != null ? String(o.phone) : null,
        email: o.email != null ? String(o.email) : null,
        address: o.address != null ? String(o.address) : null,
        description: o.description != null ? String(o.description) : null,
        budgetText: o.budgetText != null ? String(o.budgetText) : null,
        scheduledDate: o.scheduledDate != null ? String(o.scheduledDate) : null,
        scheduledTime: o.scheduledTime != null ? String(o.scheduledTime) : null,
        dateNeedsConfirmation: o.dateNeedsConfirmation === true,
        assignedEmployeeHint:
          o.assignedEmployeeHint != null ? String(o.assignedEmployeeHint) : null,
        missingFields: Array.isArray(o.missingFields)
          ? o.missingFields.map((x) => String(x))
          : [],
        sourceQuote: o.sourceQuote != null ? String(o.sourceQuote) : null,
      } satisfies ChatWorkIntentProposal;
    })
    .filter(Boolean) as ChatWorkIntentProposal[];
}

export async function analyzeChatWorkIntent(params: {
  db: Firestore;
  companyId: string;
  messageId: string;
  conversationId: string;
  messageText: string;
  messageCreatedAtMs: number | null;
  attachments: ChatAttachmentMeta[];
  attachmentIds: string[];
  createdByUid: string;
  timeZone?: string;
}): Promise<
  | { ok: true; analysis: ChatWorkIntentAnalysisDoc; cached: boolean }
  | { ok: false; status: number; error: string }
> {
  const enabled = await isChatWorkIntentEnabledForOrg(params.db, params.companyId);
  if (!enabled) {
    return { ok: false, status: 403, error: "AI analýza chatu není pro organizaci povolena." };
  }

  const timeZone = params.timeZone ?? "Europe/Prague";
  const analysisId = `cwi_${params.messageId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  const ref = params.db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection("chatWorkIntentAnalyses")
    .doc(analysisId);

  const existing = await ref.get();
  if (existing.exists) {
    return {
      ok: true,
      cached: true,
      analysis: { id: analysisId, ...(existing.data() as object) } as ChatWorkIntentAnalysisDoc,
    };
  }

  const selected = params.attachments.filter(
    (a) => params.attachmentIds.includes(a.id) && isAnalyzableMime(a.mimeType)
  );

  const media: DocumentAiInputContent[] = [];
  for (const att of selected) {
    const m = await attachmentToMedia(att);
    if (m) media.push(m);
  }

  if (!params.messageText.trim() && media.length === 0) {
    return { ok: false, status: 400, error: "Chybí text nebo analyzovatelná příloha." };
  }

  const refDate = params.messageCreatedAtMs
    ? new Date(params.messageCreatedAtMs)
    : new Date();
  const referenceDateIso = refDate.toISOString();

  try {
    const ai = await analyzeChatWorkIntentWithOpenAi({
      messageText: params.messageText,
      referenceDateIso,
      timeZone,
      media,
    });
    const parsed = JSON.parse(ai.outputText) as Record<string, unknown>;
    const readable = parsed.readable !== false;
    const unreadableReason =
      parsed.unreadableReason != null ? String(parsed.unreadableReason) : null;
    let proposals = parseAiProposals(parsed);

    const customers = await loadCustomersForMatching(params.db, params.companyId);
    const jobs = await loadRecentJobs(params.db, params.companyId);

    proposals = proposals.map((p) => {
      const customerMatch = matchCustomerForProposal(p, customers);
      const jobMatches = matchJobsForProposal(p, jobs, customerMatch?.customerId);
      return enrichProposalCompletion(
        { ...p, customerMatch, jobMatches },
        p.kind === "new_job"
      );
    });

    const analysis: ChatWorkIntentAnalysisDoc = {
      id: analysisId,
      organizationId: params.companyId,
      messageId: params.messageId,
      conversationId: params.conversationId,
      attachmentIds: params.attachmentIds,
      messageTextSnapshot: params.messageText.slice(0, 4000),
      messageCreatedAtMs: params.messageCreatedAtMs,
      timeZone,
      readable,
      unreadableReason,
      summaryCs: String(parsed.summaryCs ?? "").trim() || "Analýza dokončena.",
      proposals,
      model: ai.model,
      createdBy: params.createdByUid,
    };

    await ref.set({ ...analysis, createdAt: FieldValue.serverTimestamp() }, { merge: true });

    return { ok: true, cached: false, analysis };
  } catch (e) {
    if (e instanceof OpenAiClientError) {
      return { ok: false, status: e.statusCode, error: e.userMessage };
    }
    return { ok: false, status: 500, error: "Analýza se nezdařila." };
  }
}
