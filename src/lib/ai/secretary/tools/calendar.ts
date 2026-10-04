import type { Firestore } from "firebase-admin/firestore";
import { ORGANIZATION_CALENDAR_MEETINGS_COLLECTION } from "@/lib/calendar/organization-calendar-repository";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { SecretaryContext } from "@/lib/ai/secretary/context";
import type { SecretaryPermissions } from "@/lib/ai/secretary/permissions";
import {
  cancelPendingSecretaryAction,
  consumePendingSecretaryAction,
  loadPendingSecretaryAction,
  proposeSecretaryAction,
  updatePendingSecretaryAction,
  userUtteranceConfirmsAction,
} from "@/lib/ai/secretary/confirmation";
import {
  cancelOrganizationCalendarMeeting,
  createOrganizationCalendarMeeting,
  updateOrganizationCalendarMeeting,
  validateCalendarMeetingDraft,
  type CalendarMeetingDraft,
} from "@/lib/calendar/create-organization-meeting-server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
function draftFromArgs(
  args: Record<string, unknown>,
  ctx: SecretaryContext
): CalendarMeetingDraft {
  let date = String(args.date ?? "").trim();
  let startTime = String(args.startTime ?? args.time ?? "").trim();
  const scheduledAtIso = String(args.scheduledAtIso ?? "").trim();
  if ((!date || !startTime) && scheduledAtIso) {
    const d = new Date(scheduledAtIso);
    if (!Number.isNaN(d.getTime())) {
      const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: ctx.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      date = `${get("year")}-${get("month")}-${get("day")}`;
      startTime = `${get("hour")}:${get("minute")}`;
    }
  }
  return {
    title: String(args.title ?? "").trim(),
    date,
    startTime,
    endTime: args.endTime != null ? String(args.endTime) : null,
    customerName: args.customerName != null ? String(args.customerName) : null,
    place: args.place != null ? String(args.place) : args.address != null ? String(args.address) : null,
    note: (() => {
      const base =
        args.note != null ? String(args.note) : args.description != null ? String(args.description) : "";
      const participants = args.participants != null ? String(args.participants).trim() : "";
      if (participants && base) return `${base}\nÚčastníci: ${participants}`;
      if (participants) return `Účastníci: ${participants}`;
      return base || null;
    })(),
    phone: args.phone != null ? String(args.phone) : null,
    calendarEventType:
      String(args.calendarEventType ?? "meeting") === "installation" ? "installation" : "meeting",
    jobId: args.jobId != null ? String(args.jobId) : null,
    jobName: args.jobName != null ? String(args.jobName) : null,
    customerId: args.customerId != null ? String(args.customerId) : null,
  };
}

function formatDraftSummary(draft: CalendarMeetingDraft, ctx: SecretaryContext): string {
  const v = validateCalendarMeetingDraft(draft, ctx.timezone);
  if (!v.ok) return draft.title;
  return `Schůzka „${draft.title}“ ${v.scheduledAt.toLocaleString("cs-CZ", { timeZone: ctx.timezone })}${draft.place ? `, ${draft.place}` : ""}.`;
}

export async function getCalendarEventsTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { fromIso?: string; toIso?: string }
): Promise<{ events: Array<Record<string, unknown>> }> {
  const from = args.fromIso ? new Date(args.fromIso) : new Date();
  const to = args.toIso
    ? new Date(args.toIso)
    : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(ctx.companyId)
    .collection(ORGANIZATION_CALENDAR_MEETINGS_COLLECTION)
    .where("scheduledAt", ">=", Timestamp.fromDate(from))
    .where("scheduledAt", "<=", Timestamp.fromDate(to))
    .limit(40)
    .get();

  const events = snap.docs.map((doc) => {
    const d = doc.data();
    const at = (d.scheduledAt as Timestamp | undefined)?.toDate?.();
    return {
      id: doc.id,
      title: d.title ?? d.customerName ?? "Schůzka",
      scheduledAt: at?.toISOString?.() ?? null,
      place: d.place ?? null,
      calendarEventType: d.calendarEventType ?? "meeting",
    };
  });
  return { events };
}

export async function searchCalendarMeetingsTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { query?: string; fromIso?: string; toIso?: string }
): Promise<{ meetings: Array<Record<string, unknown>> }> {
  const { events } = await getCalendarEventsTool(db, ctx, {
    fromIso: args.fromIso,
    toIso: args.toIso,
  });
  const q = String(args.query ?? "").trim().toLowerCase();
  const meetings = events.filter((e) => {
    if (!q) return true;
    const hay = `${e.title ?? ""} ${e.place ?? ""}`.toLowerCase();
    return hay.includes(q);
  });
  return { meetings };
}

export async function proposeUpdateCalendarMeetingTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: Record<string, unknown>
): Promise<{ pendingActionId: string; summary: string; requiresConfirmation: true }> {
  const eventId = String(args.eventId ?? args.meetingId ?? "").trim();
  if (!eventId) throw new Error("Chybí eventId schůzky.");

  const draft = draftFromArgs(args, ctx);
  const v = validateCalendarMeetingDraft(draft, ctx.timezone);
  if (!v.ok) throw new Error(v.error);

  const summary = `Změna schůzky: ${formatDraftSummary(draft, ctx)}`;
  const { pendingId } = await proposeSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "update_meeting",
    payload: { eventId, draft, entityId: eventId },
    summary,
  });
  return { pendingActionId: pendingId, summary, requiresConfirmation: true };
}

export async function proposeCancelCalendarMeetingTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: Record<string, unknown>
): Promise<{ pendingActionId: string; summary: string; requiresConfirmation: true }> {
  const eventId = String(args.eventId ?? args.meetingId ?? "").trim();
  if (!eventId) throw new Error("Chybí eventId schůzky.");

  const title = String(args.title ?? args.customerName ?? "Schůzka").trim();
  const summary = `Zrušení schůzky „${title}“.`;
  const { pendingId } = await proposeSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "cancel_meeting",
    payload: { eventId, entityId: eventId, title },
    summary,
  });
  return { pendingActionId: pendingId, summary, requiresConfirmation: true };
}

export async function createCalendarMeetingDraftTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: Record<string, unknown>
): Promise<{ pendingActionId: string; summary: string; requiresConfirmation: true }> {
  const draft = draftFromArgs(args, ctx);
  const v = validateCalendarMeetingDraft(draft, ctx.timezone);
  if (!v.ok) throw new Error(v.error);
  if (!draft.title) throw new Error("Chybí název schůzky.");

  const summary = formatDraftSummary(draft, ctx);
  const { pendingId } = await proposeSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "create_calendar_meeting",
    payload: { ...draft },
    summary,
  });
  return { pendingActionId: pendingId, summary, requiresConfirmation: true };
}

export async function updateCalendarMeetingDraftTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: Record<string, unknown>
): Promise<{ ok: boolean; pendingActionId?: string; summary?: string; message?: string }> {
  const pendingId = String(args.pendingActionId ?? args.pendingId ?? "").trim();
  if (!pendingId) return { ok: false, message: "Chybí pendingActionId." };
  const pending = await loadPendingSecretaryAction(db, ctx.companyId, pendingId, ctx.userId);
  if (!pending) return { ok: false, message: "Návrh neexistuje." };

  const basePayload =
    pending.type === "update_meeting"
      ? { ...(pending.payload as { draft?: Record<string, unknown> }).draft, ...args }
      : { ...pending.payload, ...args };
  const draft = draftFromArgs(basePayload as Record<string, unknown>, ctx);
  const v = validateCalendarMeetingDraft(draft, ctx.timezone);
  if (!v.ok) return { ok: false, message: v.error };

  const summary =
    pending.type === "update_meeting"
      ? `Změna schůzky: ${formatDraftSummary(draft, ctx)}`
      : formatDraftSummary(draft, ctx);
  const payloadPatch =
    pending.type === "update_meeting"
      ? {
          eventId: String((pending.payload as { eventId?: string }).eventId ?? ""),
          entityId: String((pending.payload as { eventId?: string }).eventId ?? ""),
          draft,
        }
      : (draft as unknown as Record<string, unknown>);
  await updatePendingSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    pendingId,
    payloadPatch,
    summary,
  });
  return { ok: true, pendingActionId: pendingId, summary };
}

export async function confirmCalendarMeetingTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { pendingActionId?: string; pendingId?: string; userConfirmationText?: string }
): Promise<{ ok: boolean; message: string; eventId?: string }> {
  const pendingId = String(args.pendingActionId ?? args.pendingId ?? "").trim();
  const pending = await loadPendingSecretaryAction(db, ctx.companyId, pendingId, ctx.userId);
  if (!pending) {
    return { ok: false, message: "Návrh akce vypršel nebo neexistuje." };
  }
  if (!userUtteranceConfirmsAction(args.userConfirmationText)) {
    return {
      ok: false,
      message: "Potvrzení nebylo rozpoznáno. Řekněte například „ano“.",
    };
  }

  if (pending.type === "create_calendar_meeting") {
    const draft = pending.payload as unknown as CalendarMeetingDraft;
    const { eventId } = await createOrganizationCalendarMeeting(db, {
      companyId: ctx.companyId,
      draft,
      timeZone: ctx.timezone,
      createdByUserId: ctx.userId,
      createdByName: ctx.userDisplayName,
      createdByRole: ctx.role,
      createdVia: "ai_voice",
    });
    await db
      .collection(COMPANIES_COLLECTION)
      .doc(ctx.companyId)
      .collection("aiSecretaryPending")
      .doc(pendingId)
      .set({ status: "confirmed", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await consumePendingSecretaryAction(db, ctx.companyId, pendingId);
    const v = validateCalendarMeetingDraft(draft, ctx.timezone);
    const when =
      v.ok
        ? v.scheduledAt.toLocaleString("cs-CZ", { timeZone: ctx.timezone })
        : `${draft.date} ${draft.startTime}`;
    return {
      ok: true,
      message: `Hotovo, schůzku jsem zapsala do kalendáře na ${when}.`,
      eventId,
    };
  }

  if (pending.type === "update_meeting") {
    const payload = pending.payload as { eventId?: string; draft?: CalendarMeetingDraft };
    const eventId = String(payload.eventId ?? "").trim();
    const draft = payload.draft as CalendarMeetingDraft;
    if (!eventId || !draft) return { ok: false, message: "Neplatný návrh změny." };
    await updateOrganizationCalendarMeeting(db, {
      companyId: ctx.companyId,
      eventId,
      draft,
      timeZone: ctx.timezone,
      updatedByUserId: ctx.userId,
    });
    await consumePendingSecretaryAction(db, ctx.companyId, pendingId);
    const v = validateCalendarMeetingDraft(draft, ctx.timezone);
    const when = v.ok
      ? v.scheduledAt.toLocaleString("cs-CZ", { timeZone: ctx.timezone })
      : `${draft.date} ${draft.startTime}`;
    return { ok: true, message: `Hotovo, schůzku jsem přesunula na ${when}.`, eventId };
  }

  if (pending.type === "cancel_meeting") {
    const payload = pending.payload as { eventId?: string };
    const eventId = String(payload.eventId ?? "").trim();
    if (!eventId) return { ok: false, message: "Neplatný návrh zrušení." };
    await cancelOrganizationCalendarMeeting(db, {
      companyId: ctx.companyId,
      eventId,
      updatedByUserId: ctx.userId,
    });
    await consumePendingSecretaryAction(db, ctx.companyId, pendingId);
    return { ok: true, message: "Hotovo, schůzku jsem zrušila.", eventId };
  }

  return { ok: false, message: "Nepodporovaný typ akce." };
}

export const confirmCalendarMeetingUpdateTool = confirmCalendarMeetingTool;
export const confirmCalendarMeetingCancelTool = confirmCalendarMeetingTool;

export async function cancelPendingActionTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { pendingActionId?: string; pendingId?: string }
): Promise<{ ok: boolean; message: string }> {
  const pendingId = String(args.pendingActionId ?? args.pendingId ?? "").trim();
  const ok = await cancelPendingSecretaryAction(db, ctx.companyId, pendingId, ctx.userId);
  return ok.ok
    ? { ok: true, message: "Návrh zrušen." }
    : { ok: false, message: "Návrh nebylo možné zrušit." };
}

/** Legacy aliases */
export const proposeCreateCalendarEventTool = createCalendarMeetingDraftTool;
export const confirmPendingCalendarActionTool = confirmCalendarMeetingTool;
