import { randomUUID } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { ORGANIZATION_CALENDAR_MEETINGS_COLLECTION } from "@/lib/calendar/organization-calendar-repository";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { wallClockToUtcDate } from "@/lib/calendar/wall-clock-datetime";

export type CalendarMeetingDraft = {
  title: string;
  date: string;
  startTime: string;
  endTime?: string | null;
  customerName?: string | null;
  place?: string | null;
  note?: string | null;
  phone?: string | null;
  calendarEventType?: "meeting" | "installation";
  assignedUserIds?: string[];
  assignedEmployeeIds?: string[];
  assignedEmployeeNames?: string[];
  jobId?: string | null;
  jobName?: string | null;
  customerId?: string | null;
};

function manualLeadKeys(): { leadKey: string; importLeadId: string } {
  const id = randomUUID();
  return { leadKey: `cal-${id}`, importLeadId: `manual-${id}` };
}

export function validateCalendarMeetingDraft(
  draft: CalendarMeetingDraft,
  timeZone: string
): { ok: true; scheduledAt: Date; endsAt: Timestamp | null } | { ok: false; error: string } {
  const title = String(draft.title ?? "").trim();
  if (!title) return { ok: false, error: "Chybí název schůzky." };
  const scheduledAt = wallClockToUtcDate(draft.date, draft.startTime, timeZone);
  if (!scheduledAt) return { ok: false, error: "Neplatné datum nebo čas." };
  let endsAt: Timestamp | null = null;
  const endTime = String(draft.endTime ?? "").trim();
  if (/^\d{2}:\d{2}$/.test(endTime)) {
    const endDate = wallClockToUtcDate(draft.date, endTime, timeZone);
    if (endDate && endDate.getTime() > scheduledAt.getTime()) {
      endsAt = Timestamp.fromDate(endDate);
    }
  }
  return { ok: true, scheduledAt, endsAt };
}

/** Stejná pole jako ruční „Nová schůzka“ v kalendáři (lead_meetings). */
export async function createOrganizationCalendarMeeting(
  db: Firestore,
  input: {
    companyId: string;
    draft: CalendarMeetingDraft;
    timeZone: string;
    createdByUserId: string;
    createdByName: string;
    createdByRole: string;
    createdVia?: string;
  }
): Promise<{ eventId: string }> {
  const v = validateCalendarMeetingDraft(input.draft, input.timeZone);
  if (!v.ok) throw new Error(v.error);

  const keys = manualLeadKeys();
  const customerName = String(input.draft.customerName ?? input.draft.title).trim() || "—";
  const type = input.draft.calendarEventType === "installation" ? "installation" : "meeting";

  const payload: Record<string, unknown> = {
    companyId: input.companyId,
    organizationId: input.companyId,
    customerName,
    place: String(input.draft.place ?? "").trim(),
    note: String(input.draft.note ?? "").trim(),
    phone: String(input.draft.phone ?? "").trim(),
    scheduledAt: Timestamp.fromDate(v.scheduledAt),
    calendarEventType: type,
    title: String(input.draft.title).trim(),
    status: "planned",
    sentToAllEmployees: false,
    notificationType: null,
    notificationMessage: null,
    reminderOffsetsMinutes: [],
    assignedUserIds: input.draft.assignedUserIds ?? [input.createdByUserId],
    assignedEmployeeIds: input.draft.assignedEmployeeIds ?? [],
    assignedEmployeeNames: input.draft.assignedEmployeeNames ?? [],
    isOrganizationWide: false,
    leadKey: keys.leadKey,
    importLeadId: keys.importLeadId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: input.createdByUserId,
    createdByUserId: input.createdByUserId,
    createdByName: input.createdByName,
    createdByRole: input.createdByRole,
    createdVia: input.createdVia ?? "ai_voice",
    ...(v.endsAt ? { endsAt: v.endsAt } : {}),
    ...(input.draft.jobId ? { jobId: input.draft.jobId } : {}),
    ...(input.draft.jobName ? { jobName: input.draft.jobName } : {}),
    ...(input.draft.customerId ? { customerId: input.draft.customerId } : {}),
  };

  const ref = await db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection(ORGANIZATION_CALENDAR_MEETINGS_COLLECTION)
    .add(payload);
  return { eventId: ref.id };
}
