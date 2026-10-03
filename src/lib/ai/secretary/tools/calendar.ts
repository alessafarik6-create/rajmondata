import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { ORGANIZATION_CALENDAR_MEETINGS_COLLECTION } from "@/lib/calendar/organization-calendar-repository";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { SecretaryContext } from "@/lib/ai/secretary/context";
import type { SecretaryPermissions } from "@/lib/ai/secretary/permissions";
import {
  consumePendingSecretaryAction,
  loadPendingSecretaryAction,
  proposeSecretaryAction,
  userUtteranceConfirmsAction,
} from "@/lib/ai/secretary/confirmation";

function parseLocalDateTime(isoOrLocal: string, timezone: string): Date | null {
  const s = String(isoOrLocal ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  try {
    const parts = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!parts) return null;
    const [, y, mo, da, h, mi] = parts;
    const fmt = `${y}-${mo}-${da}T${h}:${mi}:00`;
    const utc = new Date(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(fmt))
    );
    return Number.isNaN(utc.getTime()) ? new Date(fmt) : utc;
  } catch {
    return null;
  }
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

export async function proposeCreateCalendarEventTool(
  db: Firestore,
  ctx: SecretaryContext,
  _perms: SecretaryPermissions,
  args: {
    title: string;
    scheduledAtIso: string;
    place?: string;
    note?: string;
    calendarEventType?: string;
  }
): Promise<{ pendingId: string; summary: string; requiresConfirmation: true }> {
  const scheduledAt = parseLocalDateTime(args.scheduledAtIso, ctx.timezone);
  if (!scheduledAt) {
    throw new Error("Neplatný datum/čas. Upřesněte prosím.");
  }
  if (!String(args.title ?? "").trim()) {
    throw new Error("Chybí název schůzky.");
  }

  const summary = `Schůzka „${args.title.trim()}“ ${scheduledAt.toLocaleString("cs-CZ", { timeZone: ctx.timezone })}${args.place ? `, místo: ${args.place}` : ""}.`;

  const { pendingId } = await proposeSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "create_calendar_event",
    payload: {
      title: args.title.trim(),
      scheduledAtIso: scheduledAt.toISOString(),
      place: args.place?.trim() || null,
      note: args.note?.trim() || null,
      calendarEventType: args.calendarEventType === "installation" ? "installation" : "meeting",
    },
    summary,
  });

  return { pendingId, summary, requiresConfirmation: true };
}

export async function confirmPendingCalendarActionTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { pendingId: string; userConfirmationText?: string }
): Promise<{ ok: boolean; message: string; eventId?: string }> {
  const pending = await loadPendingSecretaryAction(
    db,
    ctx.companyId,
    args.pendingId,
    ctx.userId
  );
  if (!pending) {
    return { ok: false, message: "Návrh akce vypršel nebo neexistuje." };
  }
  if (!userUtteranceConfirmsAction(args.userConfirmationText)) {
    return {
      ok: false,
      message: "Potvrzení nebylo rozpoznáno. Řekněte například „ano“ nebo „potvrzuji“.",
    };
  }

  if (pending.type === "create_calendar_event") {
    const p = pending.payload;
    const scheduledAt = new Date(String(p.scheduledAtIso));
    const ref = await db
      .collection(COMPANIES_COLLECTION)
      .doc(ctx.companyId)
      .collection(ORGANIZATION_CALENDAR_MEETINGS_COLLECTION)
      .add({
        companyId: ctx.companyId,
        organizationId: ctx.companyId,
        title: p.title,
        customerName: p.title,
        place: p.place ?? "",
        note: p.note ?? "",
        scheduledAt: Timestamp.fromDate(scheduledAt),
        calendarEventType: p.calendarEventType ?? "meeting",
        status: "planned",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: ctx.userId,
        createdByUserId: ctx.userId,
        createdByName: ctx.userDisplayName,
        createdVia: "ai_voice",
        assignedUserIds: [ctx.userId],
        assignedEmployeeIds: [],
        assignedEmployeeNames: [],
      });
    await consumePendingSecretaryAction(db, ctx.companyId, args.pendingId);
    return {
      ok: true,
      message: `Hotovo. Schůzka je uložená na ${scheduledAt.toLocaleString("cs-CZ", { timeZone: ctx.timezone })}.`,
      eventId: ref.id,
    };
  }

  return { ok: false, message: "Nepodporovaný typ akce." };
}
