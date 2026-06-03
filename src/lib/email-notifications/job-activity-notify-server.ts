import { createHash } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  absoluteUrl,
  isValidEmail,
  loadCompanyEmailBranding,
  normalizeEmail,
  resolveCustomerEmailForJob,
  wrapPortalEmailHtml,
} from "@/lib/customer-portal-email";
import { isFolderEmployeeVisible } from "@/lib/job-employee-access";
import {
  jobChatEmailEnabled,
  photoDocUnreadEmailEnabled,
} from "@/lib/job-photo-comment-email-settings";
import {
  loadCompanyEmailSettings,
  resolveNotificationEmailsForModule,
} from "@/lib/email-notifications/dispatch";
import {
  isModuleEventEnabled,
  type EmailModuleKey,
} from "@/lib/email-notifications/schema";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";

const PRIVILEGED_ROLES = new Set(["owner", "admin", "manager", "accountant"]);

export type JobActivityNotifyEvent =
  | "file_upload"
  | "folder_create"
  | "file_note"
  | "drawing_annotation"
  | "job_chat"
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
  /** U poznámek — interní poznámka zákazníkovi neposílat. */
  visibleToCustomer?: boolean | null;
  entityId?: string | null;
};

type Recipient = {
  email: string;
  uid?: string | null;
  role?: string | null;
  kind: "admin" | "employee" | "customer" | "module";
};

function orgModuleForEvent(
  eventType: JobActivityNotifyEvent,
  actorRole: string
): { module: EmailModuleKey; eventKey: string } {
  switch (eventType) {
    case "file_upload":
    case "folder_create":
      return { module: "orders", eventKey: "attachmentAdded" };
    case "file_note":
    case "drawing_annotation":
    case "customer_drawing_reminder":
      return { module: "orders", eventKey: "noteAdded" };
    case "drawing_approved":
    case "drawing_rejected":
      return { module: "orders", eventKey: "orderStatusChanged" };
    case "job_chat":
      return actorRole === "customer"
        ? { module: "messages", eventKey: "newCustomerMessage" }
        : { module: "messages", eventKey: "newInternalMessage" };
    case "file_chat":
      return { module: "messages", eventKey: "newInternalMessage" };
  }
}

function eventLabelCs(eventType: JobActivityNotifyEvent): string {
  const map: Record<JobActivityNotifyEvent, string> = {
    file_upload: "Nahrání souboru",
    folder_create: "Nová složka",
    file_note: "Poznámka k souboru / výkresu",
    drawing_annotation: "Anotace ve výkresu",
    job_chat: "Zpráva v chatu zakázky",
    file_chat: "Zpráva u souboru",
    customer_drawing_reminder: "Připomínka zákazníka k výkresu",
    drawing_approved: "Schválení výkresu",
    drawing_rejected: "Zamítnutí / připomínka k výkresu",
  };
  return map[eventType];
}

function isFolderVisibleToCustomer(folder: Record<string, unknown> | null): boolean {
  if (!folder) return false;
  if (folder.internalOnly === true) return false;
  return folder.customerVisible === true;
}

function employeeCanSeeFolder(
  folder: Record<string, unknown> | null,
  folderId: string | null,
  member: Record<string, unknown> | null
): boolean {
  if (!folder) return true;
  if (!isFolderEmployeeVisible(folder)) return false;
  const perms = member?.jobPermissions as { allowedFolderIds?: string[]; canViewPhotoFolders?: boolean } | undefined;
  if (perms?.canViewPhotoFolders === false) return false;
  const allowed = perms?.allowedFolderIds;
  if (Array.isArray(allowed) && allowed.length > 0 && folderId && !allowed.includes(folderId)) {
    return false;
  }
  return true;
}

function userWantsEmail(
  user: Record<string, unknown> | undefined,
  eventType: JobActivityNotifyEvent
): boolean {
  if (!user) return true;
  if (String(user.role ?? "") === "customer") return true;
  switch (eventType) {
    case "job_chat":
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
  jobId: string,
  input: JobActivityNotifyInput
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

async function resolveRecipients(
  db: Firestore,
  input: JobActivityNotifyInput,
  job: Record<string, unknown>,
  folder: Record<string, unknown> | null
): Promise<Recipient[]> {
  const out = new Map<string, Recipient>();
  const actorUid = input.actorUid.trim();
  const actorRole = String(input.actorRole ?? "").trim();
  const folderId = input.folderId?.trim() || null;
  const customerVisible =
    input.visibleToCustomer !== false && isFolderVisibleToCustomer(folder);
  const internalFolder = folder?.internalOnly === true;

  const usersSnap = await db
    .collection("users")
    .where("companyId", "==", input.companyId)
    .get();

  for (const docSnap of usersSnap.docs) {
    const uid = docSnap.id;
    if (uid === actorUid) continue;
    const u = docSnap.data() as Record<string, unknown>;
    const role = String(u.role ?? "").trim();
    if (!PRIVILEGED_ROLES.has(role)) continue;
    const email = normalizeEmail(u.email);
    if (!email || !isValidEmail(email)) continue;
    out.set(email, { email, uid, role, kind: "admin" });
  }

  const membersSnap = await db
    .collection("companies")
    .doc(input.companyId)
    .collection("jobs")
    .doc(input.jobId)
    .collection("jobMembers")
    .get();

  for (const docSnap of membersSnap.docs) {
    const m = docSnap.data() as Record<string, unknown>;
    const uid = String(m.authUserId ?? "").trim();
    if (!uid || uid === actorUid) continue;
    if (!employeeCanSeeFolder(folder, folderId, m)) continue;
    const uSnap = await db.collection("users").doc(uid).get();
    const u = uSnap.data() as Record<string, unknown> | undefined;
    if (!u || String(u.role ?? "") !== "employee") continue;
    const email = normalizeEmail(u.email);
    if (!email || !isValidEmail(email)) continue;
    out.set(email, { email, uid, role: "employee", kind: "employee" });
  }

  if (customerVisible && !internalFolder && actorRole !== "customer") {
    const customerEmail = await resolveCustomerEmailForJob({
      db,
      companyId: input.companyId,
      job,
    });
    if (customerEmail && isValidEmail(customerEmail)) {
      out.set(customerEmail, { email: customerEmail, role: "customer", kind: "customer" });
    }
  }

  if (actorRole === "customer" || input.eventType === "customer_drawing_reminder") {
    // admin + employees already collected
  }

  const settings = await loadCompanyEmailSettings(db, input.companyId);
  if (settings?.enabled) {
    const { module, eventKey } = orgModuleForEvent(input.eventType, actorRole);
    if (isModuleEventEnabled(settings, module, eventKey)) {
      const moduleEmails = await resolveNotificationEmailsForModule(
        db,
        input.companyId,
        settings,
        module
      );
      for (const email of moduleEmails) {
        const n = normalizeEmail(email);
        if (n && isValidEmail(n)) {
          out.set(n, { email: n, kind: "module" });
        }
      }
    }
  }

  const actorSnap = await db.collection("users").doc(actorUid).get();
  const actorEmail = normalizeEmail((actorSnap.data() as { email?: string } | undefined)?.email);
  if (actorEmail) out.delete(actorEmail);

  return [...out.values()];
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
  const folder = await loadFolder(db, input.companyId, input.jobId, input.folderId?.trim() || null);

  if (folder?.internalOnly === true && input.eventType !== "job_chat" && input.eventType !== "file_chat") {
    if (input.visibleToCustomer !== true && input.actorRole !== "employee") {
      // interní složka — zákazník už vyfiltrován v resolveRecipients
    }
  }

  const recipients = await resolveRecipients(db, input, job, folder);
  if (recipients.length === 0) {
    return { ok: true, sent: 0, skipped: 0, failed: 0 };
  }

  const branding = await loadCompanyEmailBranding(db, input.companyId);
  const jobTitle =
    String(job.name ?? job.title ?? job.jobTitle ?? "").trim() || input.jobId;
  const folderLabel = input.folderName?.trim() || (input.folderId ? "Složka" : "—");
  const actorName = input.actorName?.trim() || "Uživatel";
  const when = new Date().toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" });
  const activity = eventLabelCs(input.eventType);

  let fileLine = input.fileName?.trim() || "";
  if (input.batchFileNames?.length) {
    fileLine =
      input.batchFileNames.length === 1
        ? input.batchFileNames[0]!
        : `${input.batchFileNames.length} souborů: ${input.batchFileNames.slice(0, 5).join(", ")}${input.batchFileNames.length > 5 ? "…" : ""}`;
  }

  const preview = input.messagePreview?.trim().slice(0, 400) || "";
  const paragraphs = [
    `${activity} v zakázce „${jobTitle}".`,
    `Složka: ${folderLabel}.`,
    fileLine ? `Soubor: ${fileLine}.` : "",
    preview ? `Text: ${preview}` : "",
    `Provedl: ${actorName}.`,
    `Datum a čas: ${when}.`,
  ].filter(Boolean);

  const subject = `${activity} — ${jobTitle}`;

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

    const linkPath = portalPathForRecipient(recipient.role, input.jobId, input);
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
