import type { ChatWorkIntentProposal } from "@/lib/chat/chat-work-intent-types";
import type { ChatWorkIntentJobApplyDraft } from "@/lib/chat/chat-work-intent-apply-types";

export function defaultJobTitleFromProposal(p: ChatWorkIntentProposal, idx: number): string {
  return (
    String(p.jobTitle ?? "").trim() ||
    (p.detectedType === "reservation" ? `Rezervace ${idx + 1}` : `Zakázka ${idx + 1}`)
  );
}

export function proposalToApplyDraft(
  p: ChatWorkIntentProposal,
  proposalIndex: number
): ChatWorkIntentJobApplyDraft {
  return {
    jobTitle: defaultJobTitleFromProposal(p, proposalIndex),
    scheduledDate: p.scheduledDate ?? "",
    scheduledEndDate: p.scheduledEndDate ?? "",
    customerId: p.customerMatch?.customerId ?? null,
    customerName: p.customerName ?? p.companyName ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    address: p.address ?? "",
    createNewCustomer: !p.customerMatch?.customerId,
    note: "",
    assignedEmployeeIds: [],
    notifyEmployee: false,
  };
}

export function mergeProposalWithDraft(
  p: ChatWorkIntentProposal,
  draft: ChatWorkIntentJobApplyDraft | undefined,
  proposalIndex: number
): ChatWorkIntentJobApplyDraft {
  const base = proposalToApplyDraft(p, proposalIndex);
  if (!draft) return base;
  return {
    ...base,
    ...draft,
    jobTitle: draft.jobTitle?.trim() || base.jobTitle,
    assignedEmployeeIds: draft.assignedEmployeeIds ?? base.assignedEmployeeIds,
  };
}
