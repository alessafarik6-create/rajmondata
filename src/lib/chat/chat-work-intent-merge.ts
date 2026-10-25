import type {
  ChatWorkIntentDetectedItem,
  ChatWorkIntentProposal,
} from "@/lib/chat/chat-work-intent-types";
import {
  extractDateRangesFromText,
  findOverlappingRangeIds,
} from "@/lib/chat/chat-work-intent-date-extract";

function mapDetectedTypeToKind(
  type: string
): ChatWorkIntentProposal["kind"] {
  switch (type) {
    case "job":
    case "reservation":
      return "new_job";
    case "task":
      return "task";
    case "meeting":
      return "meeting";
    case "note":
      return "note_to_job";
    default:
      return "unclear";
  }
}

export function detectedItemsToProposals(
  items: ChatWorkIntentDetectedItem[],
  documentType: string | null
): ChatWorkIntentProposal[] {
  return items.map((item, idx) => {
    const isReservation =
      item.type === "reservation" || documentType === "reservation_schedule";
    const title =
      item.title?.trim() ||
      (isReservation ? `Rezervace ${idx + 1}` : `Položka ${idx + 1}`);
    return {
      proposalId: item.itemId || `p${idx + 1}`,
      kind: mapDetectedTypeToKind(item.type),
      confidence: item.confidence,
      jobTitle: title,
      customerName: item.customerName,
      companyName: item.companyName,
      phone: item.phone,
      email: item.email,
      address: item.address,
      description: item.description,
      budgetText: null,
      scheduledDate: item.startDate,
      scheduledEndDate: item.endDate,
      scheduledTime: item.scheduledTime,
      dateNeedsConfirmation: item.yearNeedsConfirmation,
      assignedEmployeeHint: item.assignedEmployeeHint,
      missingFields: [],
      sourceQuote: item.sourceText,
      detectedType: item.type,
    };
  });
}

export function mergeAnalysisProposals(params: {
  aiProposals: ChatWorkIntentProposal[];
  detectedItems: ChatWorkIntentDetectedItem[];
  documentType: string | null;
  extractedTextPreview: string;
  referenceDate: Date;
}): {
  proposals: ChatWorkIntentProposal[];
  overlapWarningIds: string[];
} {
  let proposals: ChatWorkIntentProposal[] = [];

  if (params.detectedItems.length > 0) {
    proposals = detectedItemsToProposals(params.detectedItems, params.documentType);
  } else if (params.aiProposals.length > 0) {
    proposals = params.aiProposals.map((p) => ({
      ...p,
      scheduledEndDate: p.scheduledEndDate ?? null,
    }));
  }

  const fallbackRanges = extractDateRangesFromText(
    params.extractedTextPreview || params.aiProposals.map((p) => p.sourceQuote ?? "").join("\n"),
    params.referenceDate
  );

  if (fallbackRanges.length > proposals.length) {
    proposals = fallbackRanges.map((r, idx) => ({
      proposalId: `p${idx + 1}`,
      kind:
        params.documentType === "reservation_schedule" ? "new_job" : ("unclear" as const),
      confidence: 0.75,
      jobTitle:
        params.documentType === "reservation_schedule"
          ? `Rezervace ${idx + 1}`
          : `Termín ${idx + 1}`,
      customerName: null,
      companyName: null,
      phone: null,
      email: null,
      address: null,
      description: params.documentType === "reservation_schedule" ? "Rezervace termínu" : null,
      budgetText: null,
      scheduledDate: r.startDate,
      scheduledEndDate: r.endDate,
      scheduledTime: null,
      dateNeedsConfirmation: r.yearNeedsConfirmation,
      assignedEmployeeHint: null,
      missingFields: [],
      sourceQuote: r.sourceText,
      detectedType: "reservation",
    }));
  }

  const overlapWarningIds = findOverlappingRangeIds(
    proposals.map((p) => ({
      id: p.proposalId,
      startDate: String(p.scheduledDate ?? ""),
      endDate: String(p.scheduledEndDate ?? p.scheduledDate ?? ""),
    }))
  );

  return { proposals, overlapWarningIds };
}
