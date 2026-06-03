import { createHash } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  absoluteUrl,
  isValidEmail,
  loadCompanyEmailBranding,
  normalizeEmail,
  wrapPortalEmailHtml,
} from "@/lib/customer-portal-email";
import {
  parseFolderEmailNotificationSettings,
  parseJobCustomerChatNotificationSettings,
  parseJobInternalChatNotificationSettings,
  resolveRecipientsFromConfiguredList,
  type ResolvedEmailRecipient,
} from "@/lib/job-notification-recipients";
import {
  jobChatEmailEnabled,
  photoDocUnreadEmailEnabled,
} from "@/lib/job-photo-comment-email-settings";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";

export type JobActivityNotifyEvent =
  | "file_upload"
  | "folder_create"
  | "file_note"
  | "drawing_annotation"
  | "job_chat"
  | "customer_job_chat"
  | "file_chat"
  | "customer_drawing_reminder"
  | "drawing_approved"
  | "drawing_rejected";

export type JobActivityNotifyInput = {
  companyId: string;
  jobId: string;
  eventType: JobActivityNotifyEvent;
  actorUid: string;
  actorName?: string | null;
  actorRole?: string | null;
  folderId?: string | null;
  folderName?: string | null;
  fileId?: string | null;
  fileName?: string | null;
  messagePreview?: string | null;
  batchFileNames?: string[];
  visibleToCustomer?: boolean | null;
  entityId?: string | null;
};

type Recipient = {
  email: string;
  uid?: string | null;
  role?: string | null;
  kind: string;
};

const FOLDER_SCOPED_EVENTS = new Set<JobActivityNotifyEvent>([
  "file_upload",
  "folder_create",
  "file_note",
  "file_chat",
  "drawing_annotation",
]);

function eventLabelCs(eventType: JobActivityNotifyEvent): string {
  const map: Record<JobActivityNotifyEvent, string> = {
    file_upload: "Nahrání souboru",
    folder_create: "Nová složka",
    file_note: "Poznámka k souboru / výkresu",
    drawing_annotation: "Anotace ve výkresu",
    job_chat: "Interní zpráva k zakázce",
    customer_job_chat: "Zpráva v chatu se zákazníkem",
    file_chat: "Zpráva u souboru",
    customer_drawing_reminder: "Připomínka zákazníka k výkresu",
    drawing_approved: "Schválení výkresu",
    drawing_rejected: "Zamítnutí / připomínka k výkresu",
  };
  return map[eventType];
}

function isFolderMediaNotifyEvent(eventType: JobActivityNotifyEvent): boolean {
  return (
    eventType === "file_upload" ||
    eventType === "folder_create" ||
    eventType === "file_note" ||
    eventType === "drawing_annotation"
  );
}

function requiresFolderAccess(input: JobActivityNotifyInput): boolean {
  if (FOLDER_SCOPED_EVENTS.has(input.eventType)) return true;
  if (
    input.eventType === "customer_drawing_reminder" ||
    input.eventType === "drawing_approved" ||
    input.eventType === "drawing_rejected"
  ) {
    return Boolean(input.folderId?.trim());
  }
  return false;
}

function userWantsEmail(
  user: Record<string, unknown> | undefined,
  eventType: JobActivityNotifyEvent
): boolean {
  if (!user) return true;
  if (String(user.role ?? "") === "customer") return true;
  switch (eventType) {
    case "job_chat":
    case "customer_job_chat":
      return jobChatEmailEnabled(user);
    case "file_chat":
    case "file_note":
    case "drawing_annotation":
      return photoDocUnreadEmailEnabled(user);
    default:
      return jobChatEmailEnabled(user);
  }
}

function dedupId(input: JobActivityNotifyInput, email: string): string {
  const bucket = Math.floor(Date.now() / 60000);
  const entity =
    input.entityId ??
    input.fileId ??
    input.folderId ??
    (input.batchFileNames?.length ? input.batchFileNames.join(",") : "") ??
    "";
  const raw = [input.companyId, input.jobId, input.eventType, entity, email, String(bucket)].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

function portalPathForRecipient(
  role: string | null | undefined,
  jobId: string
): string {
  if (role === "customer") {
    return `/portal/customer/jobs/${encodeURIComponent(jobId)}`;
  }
  if (role === "employee") {
    return `/portal/employee/jobs/${encodeURIComponent(jobId)}`;
  }
  return `/portal/jobs/${encodeURIComponent(jobId)}`;
}

async function loadFolder(
  db: Firestore,
  companyId: string,
  jobId: string,
  folderId: string | null
): Promise<Record<string, unknown> | null> {
  if (!folderId) return null;
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .doc(jobId)
    .collection("folders")
    .doc(folderId)
    .get();
  return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
}

function toLegacyRecipients(rows: ResolvedEmailRecipient[]): Recipient[] {
  return rows.map((r) => ({
    email: r.email,
    uid: r.uid ?? null,
    role: r.role ?? null,
    kind: r.kind,
  }));
}

function filterChatRecipients(
  rows: ResolvedEmailRecipient[],
  actorRole: string,
  eventType: JobActivityNotifyEvent
): ResolvedEmailRecipient[] {
  if (eventType !== "customer_job_chat") return rows;
  if (actorRole === "customer") {
    return rows.filter((r) => r.kind === "admin" || r.kind === "custom_email");
  }
  return rows.filter((r) => r.kind === "customer" || r.kind === "custom_email");
}

async function resolveRecipients(
  db: Firestore,
  input: JobActivityNotifyInput,
  job: Record<string, unknown>,
  folder: Record<string, unknown> | null
): Promise<Recipient[]> {
  const actorRole = String(input.actorRole ?? "").trim();
  const folderId = input.folderId?.trim() || null;
  const folderMedia = isFolderMediaNotifyEvent(input.eventType);
  const requireFolder = requiresFolderAccess(input);

  let configured: ResolvedEmailRecipient[] = [];

  if (input.eventType === "customer_job_chat") {
    const chat = parseJobCustomerChatNotificationSettings(job);
    const resolved = await resolveRecipientsFromConfiguredList(db, {
      recipients: chat.recipients,
      enabled: chat.enabled,
      actorUid: input.actorUid,
      companyId: input.companyId,
      jobId: input.jobId,
      job,
      requireCustomerFolderVisibility: false,
    });
    configured = filterChatRecipients(resolved, actorRole, input.eventType);
  } else if (input.eventType === "job_chat" || input.eventType === "file_chat") {
    const chat = parseJobInternalChatNotificationSettings(job);
    const resolved = await resolveRecipientsFromConfiguredList(db, {
      recipients: chat.recipients,
      enabled: chat.enabled,
      actorUid: input.actorUid,
      companyId: input.companyId,
      jobId: input.jobId,
      job,
      folder: input.eventType === "file_chat" ? folder : null,
      folderId: input.eventType === "file_chat" ? folderId : null,
      requireCustomerFolderVisibility: false,
      allowJobAssignedEmployees: input.eventType === "job_chat",
    });
    configured = resolved;
  } else if ((folderMedia || (requireFolder && folder)) && folder) {
    const folderSettings = parseFolderEmailNotificationSettings(folder);
    configured = await resolveRecipientsFromConfiguredList(db, {
      recipients: folderSettings.recipients,
      enabled: folderSettings.enabled,
      actorUid: input.actorUid,
      companyId: input.companyId,
      jobId: input.jobId,
      job,
      folder,
      folderId,
      visibleToCustomer: input.visibleToCustomer,
      requireCustomerFolderVisibility: true,
    });
  }

  return toLegacyRecipients(configured);
}

async function writeHistory(
  db: Firestore,
  input: JobActivityNotifyInput,
  recipient: Recipient,
  status: "sent" | "skipped" | "failed",
  detail?: string | null
): Promise<void> {
  try {
    await db
      .collection("companies")
      .doc(input.companyId)
      .collection("jobs")
      .doc(input.jobId)
      .collection("emailNotificationHistory")
      .add({
        eventType: input.eventType,
        recipientEmail: recipient.email,
        recipientUid: recipient.uid ?? null,
        recipientKind: recipient.kind,
        status,
        detail: detail ?? null,
        folderId: input.folderId ?? null,
        fileId: input.fileId ?? null,
        fileName: input.fileName ?? null,
        actorUid: input.actorUid,
        actorName: input.actorName ?? null,
        sentAt: FieldValue.serverTimestamp(),
      });
  } catch (e) {
    console.warn("[job-activity-notify] history write failed", e);
  }
}

function resolveJobDisplayTitle(job: Record<string, unknown>, jobId: string): string {
  const name = String(job.name ?? job.title ?? job.jobTitle ?? "").trim();
  const number = String(
    job.jobNumber ?? job.orderNumber ?? job.documentNumber ?? job.jobTag ?? ""
  ).trim();
  if (name) return name;
  if (number) return number;
  return "Zakázka bez názvu";
}

function resolveJobNumber(job: Record<string, unknown>): string | null {
  const number = String(
    job.jobNumber ?? job.orderNumber ?? job.documentNumber ?? ""
  ).trim();
  return number || null;
}

function resolveCustomerName(job: Record<string, unknown>): string {
  return String(job.customerName ?? job.clientName ?? "").trim() || "—";
}

function buildSubject(
  input: JobActivityNotifyInput,
  jobTitle: string,
  actorRole: string
): string {
  const activity = eventLabelCs(input.eventType);
  if (actorRole === "customer") {
    return `Zákazník — ${activity}: ${jobTitle}`;
  }
  if (input.eventType === "file_upload") {
    return `Změna v zakázce: ${jobTitle} — nový soubor`;
  }
  if (input.eventType === "customer_job_chat") {
    return actorRole === "customer"
      ? `Zákazník napsal zprávu — zakázka: ${jobTitle}`
      : `Zpráva zákazníkovi — zakázka: ${jobTitle}`;
  }
  return `${activity} — ${jobTitle}`;
}

export async function dispatchJobActivityNotifications(
  db: Firestore,
  input: JobActivityNotifyInput
): Promise<{ ok: boolean; sent: number; skipped: number; failed: number }> {
  const jobSnap = await db
    .collection("companies")
    .doc(input.companyId)
    .collection("jobs")
    .doc(input.jobId)
    .get();
  if (!jobSnap.exists) {
    return { ok: false, sent: 0, skipped: 0, failed: 0 };
  }
  const job = (jobSnap.data() ?? {}) as Record<string, unknown>;
  const folderId = input.folderId?.trim() || null;
  const folder = await loadFolder(db, input.companyId, input.jobId, folderId);

  if (input.eventType === "file_upload" && folderId && !folder) {
    return { ok: true, sent: 0, skipped: 0, failed: 0 };
  }

  const recipients = await resolveRecipients(db, input, job, folder);
  if (recipients.length === 0) {
    return { ok: true, sent: 0, skipped: 0, failed: 0 };
  }

  const branding = await loadCompanyEmailBranding(db, input.companyId);
  const jobTitle = resolveJobDisplayTitle(job, input.jobId);
  const jobNumber = resolveJobNumber(job);
  const customerName = resolveCustomerName(job);
  const folderLabel =
    input.folderName?.trim() ||
    (folder && typeof folder.name === "string" ? String(folder.name).trim() : "") ||
    (folderId ? "Složka" : "—");
  const actorName = input.actorName?.trim() || "Uživatel";
  const when = new Date().toLocaleString("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const activity = eventLabelCs(input.eventType);
  const actorRole = String(input.actorRole ?? "").trim();

  let fileLine = input.fileName?.trim() || "";
  if (input.batchFileNames?.length) {
    fileLine =
      input.batchFileNames.length === 1
        ? input.batchFileNames[0]!
        : `${input.batchFileNames.length} souborů: ${input.batchFileNames.slice(0, 5).join(", ")}${input.batchFileNames.length > 5 ? "…" : ""}`;
  }

  const preview = input.messagePreview?.trim().slice(0, 400) || "";
  const paragraphs = [
    `Název zakázky: ${jobTitle}`,
    jobNumber ? `Číslo zakázky: ${jobNumber}` : null,
    `Zákazník: ${customerName}`,
    `Typ změny: ${activity}`,
    `Provedl: ${actorName}`,
    `Datum a čas: ${when}`,
    folderId ? `Složka: ${folderLabel}` : null,
    fileLine ? `Soubor / výkres: ${fileLine}` : null,
    preview ? `Text: ${preview}` : null,
  ].filter(Boolean) as string[];

  const subject = buildSubject(input, jobTitle, actorRole);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const dedupCol = db.collection("mail_notify_dedup");

  for (const recipient of recipients) {
    if (recipient.uid) {
      const uSnap = await db.collection("users").doc(recipient.uid).get();
      const u = uSnap.data() as Record<string, unknown> | undefined;
      if (!userWantsEmail(u, input.eventType)) {
        skipped += 1;
        await writeHistory(db, input, recipient, "skipped", "user_disabled");
        continue;
      }
    }

    const dedupDocId = dedupId(input, recipient.email);
    const dedupRef = dedupCol.doc(dedupDocId);
    const dedupSnap = await dedupRef.get();
    if (dedupSnap.exists) {
      skipped += 1;
      await writeHistory(db, input, recipient, "skipped", "dedup");
      continue;
    }

    const linkPath = portalPathForRecipient(recipient.role, input.jobId);
    const actionUrl = absoluteUrl(linkPath);

    const html = wrapPortalEmailHtml({
      greeting: "Dobrý den,",
      paragraphs,
      actionUrl,
      actionLabel: "Otevřít zakázku",
      companyName: branding.companyName,
      logoUrl: branding.logoUrl,
      contactEmail: branding.contactEmail,
    });

    const sendResult = await sendTransactionalEmail({
      to: [recipient.email],
      subject,
      html,
      replyTo: branding.contactEmail ?? undefined,
    });

    if (sendResult.ok) {
      sent += 1;
      await dedupRef.set({ createdAt: FieldValue.serverTimestamp() });
      await writeHistory(db, input, recipient, "sent", sendResult.messageId ?? null);
    } else {
      failed += 1;
      await writeHistory(db, input, recipient, "failed", sendResult.error ?? null);
    }
  }

  return { ok: true, sent, skipped, failed };
}
