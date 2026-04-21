/**
 * Záznamy ze schůzek — veřejná část v documents companies/{companyId}/meetingRecords/{id}.
 * Interní poznámky pouze v companies/{companyId}/meetingRecords/{id}/internal/data
 * (zákazník k nim nemá přístup v pravidlech).
 */

import type { Timestamp } from "firebase/firestore";

export const MEETING_RECORD_INTERNAL_DOC_ID = "data";

export type MeetingRecordAssignmentStatus = "assigned" | "unassigned";

export type MeetingShareEvent = {
  at: Timestamp | unknown;
  byUserId: string;
  byDisplayName?: string | null;
  action: "shared_with_customer" | "resent_to_customer";
  /** Krátký popis komu (např. „zákaznický portál — přístup přes zakázku“). */
  audienceNote?: string | null;
};

/** Veřejná část záznamu (čitelná zákazníkem po sdílení). */
export type MeetingRecordPublicRow = {
  id: string;
  companyId: string;
  /** Legacy — u nových zápisů duplicitně s meetingTitle. */
  title: string;
  /** Preferovaný název schůzky (může být prázdný, pokud stačí poznámky). */
  meetingTitle?: string | null;
  meetingAt: Timestamp | unknown;
  place?: string | null;
  participants?: string | null;
  jobId?: string | null;
  jobName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  meetingNotes: string;
  nextSteps?: string | null;
  /** Preferovaný příznak odeslání / sdílení (drží se synchronně se sharedWithCustomer). */
  sentToCustomer?: boolean;
  sharedWithCustomer: boolean;
  /** Odvozeno od jobId — usnadňuje dotazy a filtry. */
  assignmentStatus?: MeetingRecordAssignmentStatus | null;
  shareHistory?: MeetingShareEvent[];
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy: string;
  createdByName?: string | null;
  updatedBy?: string | null;
};

export type MeetingRecordInternalPayload = {
  internalNotes: string;
  updatedAt?: unknown;
  updatedBy?: string | null;
};

export function resolveMeetingTitle(row: {
  title?: string | null;
  meetingTitle?: string | null;
}): string {
  const mt =
    typeof row.meetingTitle === "string" && row.meetingTitle.trim()
      ? row.meetingTitle.trim()
      : "";
  if (mt) return mt;
  return typeof row.title === "string" ? row.title.trim() : "";
}

export function resolveSentToCustomer(row: {
  sentToCustomer?: boolean;
  sharedWithCustomer?: boolean;
}): boolean {
  if (row.sentToCustomer === true) return true;
  return row.sharedWithCustomer === true;
}

export function resolveAssignmentStatus(row: {
  jobId?: string | null;
  assignmentStatus?: MeetingRecordAssignmentStatus | null;
}): MeetingRecordAssignmentStatus {
  if (row.assignmentStatus === "assigned" || row.assignmentStatus === "unassigned") {
    return row.assignmentStatus;
  }
  const j = typeof row.jobId === "string" ? row.jobId.trim() : "";
  return j ? "assigned" : "unassigned";
}

/** Ořez pro zákaznický portál — jen pole, která smí zákazník vidět. */
export function meetingRecordForCustomerView(
  row: MeetingRecordPublicRow
): Pick<
  MeetingRecordPublicRow,
  | "id"
  | "title"
  | "meetingAt"
  | "place"
  | "participants"
  | "jobId"
  | "meetingNotes"
  | "nextSteps"
  | "sharedWithCustomer"
  | "createdAt"
> {
  const displayTitle = resolveMeetingTitle(row) || "Schůzka";
  return {
    id: row.id,
    title: displayTitle,
    meetingAt: row.meetingAt,
    place: row.place ?? null,
    participants: row.participants ?? null,
    jobId: row.jobId ?? null,
    meetingNotes: row.meetingNotes,
    nextSteps: row.nextSteps ?? null,
    sharedWithCustomer: resolveSentToCustomer(row),
    createdAt: row.createdAt,
  };
}
