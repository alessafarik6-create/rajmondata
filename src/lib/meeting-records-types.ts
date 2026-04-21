/**
 * Záznamy ze schůzek — veřejná část v documents companies/{companyId}/meetingRecords/{id}.
 * Interní poznámky pouze v companies/{companyId}/meetingRecords/{id}/internal/data
 * (zákazník k nim nemá přístup v pravidlech).
 */

import type { Timestamp } from "firebase/firestore";

export const MEETING_RECORD_INTERNAL_DOC_ID = "data";

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
  title: string;
  meetingAt: Timestamp | unknown;
  place?: string | null;
  participants?: string | null;
  jobId?: string | null;
  jobName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  meetingNotes: string;
  nextSteps?: string | null;
  sharedWithCustomer: boolean;
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
  return {
    id: row.id,
    title: row.title,
    meetingAt: row.meetingAt,
    place: row.place ?? null,
    participants: row.participants ?? null,
    jobId: row.jobId ?? null,
    meetingNotes: row.meetingNotes,
    nextSteps: row.nextSteps ?? null,
    sharedWithCustomer: row.sharedWithCustomer,
    createdAt: row.createdAt,
  };
}
