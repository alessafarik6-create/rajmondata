import { createHash } from "node:crypto";
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
  ChatWorkIntentDetectedItem,
  ChatWorkIntentProposal,
} from "@/lib/chat/chat-work-intent-types";
import {
  enrichProposalCompletion,
  loadCustomersForMatching,
  loadRecentJobs,
  matchCustomerForProposal,
  matchJobsForProposal,
} from "@/lib/chat/chat-work-intent-matching";
import {
  prepareImageTilesForVision,
  resolveImageMimeType,
} from "@/lib/chat/chat-work-intent-image-media";
import { mergeAnalysisProposals } from "@/lib/chat/chat-work-intent-merge";
import { AI_SETTINGS_DOC_ID } from "@/lib/ai/ai-settings-types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

function isAnalyzableMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return m.startsWith("image/") || m.includes("pdf");
}

function buildAnalysisDocId(messageId: string, attachmentIds: string[]): string {
  const key = `${messageId}:${[...attachmentIds].sort().join(",")}`;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `cwi_${hash}`;
}

async function attachmentToMediaParts(
  att: ChatAttachmentMeta
): Promise<{ parts: DocumentAiInputContent[]; bytes: number }> {
  let buffer =
    (att.storagePath ? await downloadChatAttachmentBuffer(att.storagePath) : null) ??
    (att.downloadUrl ? await fetchUrlBuffer(att.downloadUrl) : null);
  if (!buffer?.length || buffer.length > OPENAI_DOCUMENT_MAX_BYTES) {
    return { parts: [], bytes: 0 };
  }
  const mime = resolveImageMimeType(buffer, att.mimeType, att.fileName);
  if (mime.startsWith("image/")) {
    const tiles = await prepareImageTilesForVision(buffer, mime);
    if (!tiles.length) return { parts: [], bytes: 0 };
    const parts: DocumentAiInputContent[] = tiles.map((t) => ({
      kind: "image",
      mimeType: t.mimeType,
      base64: t.base64,
    }));
    return { parts, bytes: buffer.length };
  }
  if (mime.includes("pdf") || att.mimeType.includes("pdf")) {
    const text = await extractPdfTextContent(buffer).catch(() => "");
    if (text.trim().length >= 40) {
      return {
        parts: [{ kind: "pdf_text", text, fileName: att.fileName }],
        bytes: buffer.length,
      };
    }
    return {
      parts: [{ kind: "pdf", base64: buffer.toString("base64"), fileName: att.fileName }],
      bytes: buffer.length,
    };
  }
  return { parts: [], bytes: 0 };
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

function parseDetectedItems(raw: unknown): ChatWorkIntentDetectedItem[] {
  if (!raw || typeof raw !== "object") return [];
  const items = (raw as { detectedItems?: unknown }).detectedItems;
  if (!Array.isArray(items)) return [];
  return items
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      return {
        itemId: String(o.itemId ?? `d${idx + 1}`),
        type: String(o.type ?? "unclear") as ChatWorkIntentDetectedItem["type"],
        title: o.title != null ? String(o.title) : null,
        customerName: o.customerName != null ? String(o.customerName) : null,
        companyName: o.companyName != null ? String(o.companyName) : null,
        phone: o.phone != null ? String(o.phone) : null,
        email: o.email != null ? String(o.email) : null,
        address: o.address != null ? String(o.address) : null,
        description: o.description != null ? String(o.description) : null,
        startDate: o.startDate != null ? String(o.startDate) : null,
        endDate: o.endDate != null ? String(o.endDate) : null,
        scheduledTime: o.scheduledTime != null ? String(o.scheduledTime) : null,
        sourceText: o.sourceText != null ? String(o.sourceText) : null,
        yearNeedsConfirmation: o.yearNeedsConfirmation === true,
        confidence: Number(o.confidence ?? 0.5),
        assignedEmployeeHint:
          o.assignedEmployeeHint != null ? String(o.assignedEmployeeHint) : null,
      } satisfies ChatWorkIntentDetectedItem;
    })
    .filter(Boolean) as ChatWorkIntentDetectedItem[];
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
        scheduledEndDate: o.scheduledEndDate != null ? String(o.scheduledEndDate) : null,
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
  force?: boolean;
}): Promise<
  | { ok: true; analysis: ChatWorkIntentAnalysisDoc; cached: boolean }
  | { ok: false; status: number; error: string }
> {
  const enabled = await isChatWorkIntentEnabledForOrg(params.db, params.companyId);
  if (!enabled) {
    return { ok: false, status: 403, error: "AI analýza chatu není pro organizaci povolena." };
  }

  const timeZone = params.timeZone ?? "Europe/Prague";
  const analysisId = buildAnalysisDocId(params.messageId, params.attachmentIds);
  const ref = params.db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection("chatWorkIntentAnalyses")
    .doc(analysisId);

  if (params.force) {
    await ref.delete().catch(() => undefined);
  } else {
    const existing = await ref.get();
    if (existing.exists) {
      return {
        ok: true,
        cached: true,
        analysis: { id: analysisId, ...(existing.data() as object) } as ChatWorkIntentAnalysisDoc,
      };
    }
  }

  const selected = params.attachments.filter(
    (a) => params.attachmentIds.includes(a.id) && isAnalyzableMime(a.mimeType)
  );

  const media: DocumentAiInputContent[] = [];
  let imageBytesSent = 0;
  let imageTilesSent = 0;

  for (const att of selected) {
    const { parts, bytes } = await attachmentToMediaParts(att);
    if (parts.length) {
      imageBytesSent += bytes;
      imageTilesSent += parts.filter((p) => p.kind === "image").length;
      media.push(...parts);
    }
  }

  const expectsImage = selected.length > 0;
  if (expectsImage && media.length === 0) {
    return {
      ok: false,
      status: 422,
      error:
        "Obrázek se nepodařilo načíst ze storage. Zkuste znovu odeslat přílohu nebo spusťte analýzu znovu.",
    };
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
      imageTilesSent,
    });
    const parsed = JSON.parse(ai.outputText) as Record<string, unknown>;
    const readable = parsed.readable !== false;
    const unreadableReason =
      parsed.unreadableReason != null ? String(parsed.unreadableReason) : null;

    if (expectsImage && imageTilesSent === 0) {
      return {
        ok: false,
        status: 422,
        error: "Analýza neobdržela obrazová data — zkuste to znovu.",
      };
    }

    const documentType =
      parsed.documentType != null ? String(parsed.documentType) : "unknown";
    const extractedTextPreview = String(parsed.extractedTextPreview ?? "").trim();
    const detectedItems = parseDetectedItems(parsed);
    const aiProposals = parseAiProposals(parsed);

    const { proposals: mergedProposals, overlapWarningIds } = mergeAnalysisProposals({
      aiProposals,
      detectedItems,
      documentType,
      extractedTextPreview,
      referenceDate: refDate,
    });

    let proposals = mergedProposals.map((p) =>
      overlapWarningIds.includes(p.proposalId) ? { ...p, overlapWarning: true } : p
    );

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
      documentType,
      extractedTextPreview: extractedTextPreview.slice(0, 8000),
      detectedItems,
      summaryCs: String(parsed.summaryCs ?? "").trim() || "Analýza dokončena.",
      proposals,
      model: ai.model,
      imageTilesSent,
      imageBytesSent,
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
