import { createHash } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import {
  type EmailModuleKey,
  type EmailNotificationsSettings,
  type ModuleRecipientFields,
  isModuleEventEnabled,
  mergeEmailNotifications,
} from "./schema";
import { buildNotificationHtml, sendTransactionalEmail } from "./resend-send";
import { defaultSubjectForEvent, moduleLabelCs } from "./subjects";

export const MAIL_DISPATCH_QUEUE = "mail_dispatch_queue";
export const MAIL_NOTIFY_DEDUP = "mail_notify_dedup";

export type DispatchOrgEmailInput = {
  companyId: string;
  module: EmailModuleKey;
  /** Klíč pole v příslušném modulu (např. newOrder). U připomenutí kalendáře použijte "reminder". */
  eventKey: string;
  entityId?: string;
  title: string;
  lines: string[];
  /** Cesta v aplikaci, např. /portal/jobs/abc */
  actionPath?: string | null;
  /** Volitelný vlastní předmět */
  subjectOverride?: string;
};

function appBaseUrl(): string {
  return (
    String(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "")
      .trim()
      .replace(/\/$/, "") || ""
  );
}

function resolveActionHref(path: string | null | undefined): string | null {
  if (!path) return null;
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = appBaseUrl();
  return base ? `${base}${p}` : p;
}

function dedupDocumentId(input: DispatchOrgEmailInput): string {
  const bucket = Math.floor(Date.now() / 45000);
  const raw = [
    input.companyId,
    input.module,
    input.eventKey,
    input.entityId ?? "",
    String(bucket),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

async function shouldSendDedup(
  db: Firestore,
  dedupId: string
): Promise<boolean> {
  const ref = db.collection(MAIL_NOTIFY_DEDUP).doc(dedupId);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ createdAt: FieldValue.serverTimestamp() });
    return true;
  }
  const createdAt = snap.data()?.createdAt as Timestamp | undefined;
  const ms = createdAt?.toMillis?.() ?? 0;
  if (Date.now() - ms < 25000) {
    return false;
  }
  await ref.set({ createdAt: FieldValue.serverTimestamp() });
  return true;
}

export async function loadCompanyEmailSettings(
  db: Firestore,
  companyId: string
): Promise<EmailNotificationsSettings | null> {
  const c = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  const o = await db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).get();
  if (!c.exists && !o.exists) return null;
  const raw =
    (c.exists ? (c.data() as { emailNotifications?: unknown }).emailNotifications : undefined) ??
    (o.exists ? (o.data() as { emailNotifications?: unknown }).emailNotifications : undefined);
  return mergeEmailNotifications(raw ?? {});
}

async function companyDisplayName(
  db: Firestore,
  companyId: string
): Promise<string | null> {
  const c = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  const d = c.data() as { companyName?: string; name?: string } | undefined;
  if (!d) return null;
  return String(d.companyName || d.name || "").trim() || null;
}

function normEmail(s: string): string | null {
  const x = s.trim().toLowerCase();
  return x || null;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

async function addEmailsFromLists(
  db: Firestore,
  companyId: string,
  out: Set<string>,
  lists: {
    manual: string[];
    authUserIds: string[];
    employeeIds: string[];
  }
): Promise<void> {
  for (const e of lists.manual) {
    const n = normEmail(e);
    if (n && isValidEmail(n)) out.add(n);
  }
  for (const uid of lists.authUserIds) {
    if (!uid?.trim()) continue;
    const snap = await db.collection("users").doc(uid.trim()).get();
    const mail = normEmail(
      String((snap.data() as { email?: string } | undefined)?.email ?? "")
    );
    if (mail && isValidEmail(mail)) out.add(mail);
  }
  for (const empId of lists.employeeIds) {
    if (!empId?.trim()) continue;
    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("employees")
      .doc(empId.trim())
      .get();
    const mail = normEmail(
      String((snap.data() as { email?: string } | undefined)?.email ?? "")
    );
    if (mail && isValidEmail(mail)) out.add(mail);
  }
}

/** Příjemci pouze z globálních seznamů (bez fallbacku na administrátory). */
export async function resolveGlobalRecipientEmails(
  db: Firestore,
  companyId: string,
  settings: EmailNotificationsSettings
): Promise<string[]> {
  const out = new Set<string>();
  await addEmailsFromLists(db, companyId, out, {
    manual: settings.globalRecipients,
    authUserIds: settings.globalRecipientUserIds,
    employeeIds: settings.globalRecipientEmployeeIds,
  });
  return [...out];
}

/**
 * Příjemci pro konkrétní modul: podle useGlobalRecipients buď globální seznamy, nebo vlastní u modulu.
 * Bez fallbacku na administrátory — pouze uložená konfigurace notifikací.
 */
export async function resolveNotificationEmailsForModule(
  db: Firestore,
  companyId: string,
  settings: EmailNotificationsSettings,
  module: EmailModuleKey
): Promise<string[]> {
  const out = new Set<string>();
  const mod = settings.modules[module] as ModuleRecipientFields;
  if (mod.useGlobalRecipients) {
    await addEmailsFromLists(db, companyId, out, {
      manual: settings.globalRecipients,
      authUserIds: settings.globalRecipientUserIds,
      employeeIds: settings.globalRecipientEmployeeIds,
    });
  } else {
    await addEmailsFromLists(db, companyId, out, {
      manual: mod.recipients,
      authUserIds: mod.recipientUserIds,
      employeeIds: mod.recipientEmployeeIds,
    });
  }
  return [...out];
}

/** @deprecated Použijte resolveGlobalRecipientEmails nebo resolveNotificationEmailsForModule. */
export async function resolveNotificationEmails(
  db: Firestore,
  companyId: string,
  settings: EmailNotificationsSettings
): Promise<string[]> {
  return resolveGlobalRecipientEmails(db, companyId, settings);
}

/**
 * Odešle modulovou notifikaci (volat jen ze serveru po ověření identity volajícího).
 */
export async function dispatchOrgModuleEmail(
  db: Firestore | null,
  input: DispatchOrgEmailInput
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  if (!db) {
    return { ok: false, error: "Databáze není dostupná." };
  }
  const settings = await loadCompanyEmailSettings(db, input.companyId);
  if (!settings) {
    return { ok: false, error: "Organizace nenalezena nebo chybí dokument firmy." };
  }
  if (!isModuleEventEnabled(settings, input.module, input.eventKey)) {
    return { ok: true, skipped: "disabled" };
  }
  const recipients = await resolveNotificationEmailsForModule(
    db,
    input.companyId,
    settings,
    input.module
  );
  if (recipients.length === 0) {
    return { ok: true, skipped: "no_recipients" };
  }

  const dedupId = dedupDocumentId(input);
  const allow = await shouldSendDedup(db, dedupId);
  if (!allow) {
    return { ok: true, skipped: "dedup" };
  }

  const companyName = await companyDisplayName(db, input.companyId);
  const subject =
    input.subjectOverride?.trim() ||
    defaultSubjectForEvent(input.module, input.eventKey);
  const actionUrl = resolveActionHref(input.actionPath ?? null);
  const html = buildNotificationHtml({
    moduleLabel: moduleLabelCs(input.module),
    title: input.title,
    lines: input.lines,
    actionUrl,
    companyName,
  });

  const sent = await sendTransactionalEmail({ to: recipients, subject, html });
  if (!sent.ok) {
    return { ok: false, error: sent.error };
  }
  return { ok: true };
}

export type CalendarQueuePayload = {
  companyId: string;
  eventId: string;
  /** ISO */
  eventStartsAt: string;
  title: string;
  calendarKind: "meeting" | "measurement";
  offsetMinutes: number;
};

/**
 * Naplánuje připomenutí kalendáře (odeslání přes frontu + cron).
 */
const ALL_REMINDER_OFFSET_PRESETS = [15, 30, 60, 180, 1440] as const;

function calendarReminderQueueDocId(eventId: string, offsetMinutes: number): string {
  return `cal_${eventId}_${offsetMinutes}`;
}

export async function enqueueCalendarReminder(
  db: Firestore,
  payload: CalendarQueuePayload
): Promise<void> {
  const start = new Date(payload.eventStartsAt);
  if (Number.isNaN(start.getTime())) return;
  const sendAt = new Date(start.getTime() - payload.offsetMinutes * 60_000);
  if (sendAt.getTime() <= Date.now()) {
    return;
  }
  const dedupKey = `cal-${payload.eventId}-${payload.offsetMinutes}`;
  const docId = calendarReminderQueueDocId(payload.eventId, payload.offsetMinutes);
  const ref = db.collection(MAIL_DISPATCH_QUEUE).doc(docId);
  await ref.set({
    kind: "calendar_reminder",
    companyId: payload.companyId,
    dedupKey,
    sendAt: Timestamp.fromDate(sendAt),
    createdAt: FieldValue.serverTimestamp(),
    payload: {
      eventId: payload.eventId,
      eventStartsAt: payload.eventStartsAt,
      title: payload.title,
      calendarKind: payload.calendarKind,
      offsetMinutes: payload.offsetMinutes,
    },
  });
}

/** Smaže naplánovaná připomenutí pro danou událost. */
export async function deleteCalendarReminderQueueForEvent(
  db: Firestore,
  eventId: string
): Promise<void> {
  const col = db.collection(MAIL_DISPATCH_QUEUE);
  const batch = db.batch();
  for (const offset of ALL_REMINDER_OFFSET_PRESETS) {
    batch.delete(col.doc(calendarReminderQueueDocId(eventId, offset)));
  }
  await batch.commit();
}

export async function syncCalendarRemindersForEvent(
  db: Firestore,
  companyId: string,
  input: {
    eventId: string;
    eventStartsAtIso: string;
    title: string;
    calendarKind: "meeting" | "measurement";
  }
): Promise<void> {
  const loaded = await loadCompanyEmailSettings(db, companyId);
  if (!loaded) return;
  const settings = loaded;
  const cal = settings.modules.calendar;
  if (!settings.enabled || !cal.enabled || !cal.reminderEnabled) {
    await deleteCalendarReminderQueueForEvent(db, input.eventId);
    return;
  }
  if (cal.reminderMeetingsOnly && input.calendarKind !== "meeting") {
    await deleteCalendarReminderQueueForEvent(db, input.eventId);
    return;
  }
  await deleteCalendarReminderQueueForEvent(db, input.eventId);
  for (const offset of cal.reminderOffsetsMinutes) {
    await enqueueCalendarReminder(db, {
      companyId,
      eventId: input.eventId,
      eventStartsAt: input.eventStartsAtIso,
      title: input.title,
      calendarKind: input.calendarKind,
      offsetMinutes: offset,
    });
  }
}
