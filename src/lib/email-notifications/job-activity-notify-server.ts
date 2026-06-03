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
import {
  canCustomerAccessJob,
  isFolderCustomerVisible,
} from "@/lib/job-customer-access";
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

/** Události vázané na konkrétní složku — příjemci jen podle oprávnění složky. */
const FOLDER_SCOPED_EVENTS = new Set<JobActivityNotifyEvent>([
  "file_upload",
  "folder_create",
  "file_note",
  "file_chat",
  "drawing_annotation",
]);

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

function employeeCanSeeFolder(
  folder: Record<string, unknown> | null,
  folderId: string | null,
  member: Record<string, unknown> | null,
  requireFolder: boolean
): boolean {
  if (requireFolder && !folderId) return false;
  if (!folder) return !requireFolder;
  if (!isFolderEmployeeVisible(folder)) return false;
  const perms = member?.jobPermissions as
    | { allowedFolderIds?: string[]; canViewPhotoFolders?: boolean }
    | undefined;
  if (perms?.canViewPhotoFolders === false) return false;
  const allowed = perms?.allowedFolderIds;
  if (Array.isArray(allowed) && allowed.length > 0 && folderId && !allowed.includes(folderId)) {
    return false;
  }
  return true;
}

function customerMayReceiveForFolder(
  folder: Record<string, unknown> | null,
  input: JobActivityNotifyInput,
  requireFolder: boolean
): boolean {
  if (requireFolder && !input.folderId?.trim()) return false;
  if (!folder) return !requireFolder;
  if (input.visibleToCustomer === false) return false;
  return isFolderCustomerVisible(folder);
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

async function addModuleRecipients(
  db: Firestore,
  out: Map<string, Recipient>,
  input: JobActivityNotifyInput,
  actorUid: string
): Promise<void> {
  const settings = await loadCompanyEmailSettings(db, input.companyId);
  if (!settings?.enabled) return;
  const actorRole = String(input.actorRole ?? "").trim();
  const { module, eventKey } = orgModuleForEvent(input.eventType, actorRole);
  if (!isModuleEventEnabled(settings, module, eventKey)) return;

  const moduleEmails = await resolveNotificationEmailsForModule(
    db,
    input.companyId,
    settings,
    module
  );
  for (const email of moduleEmails) {
    const n = normalizeEmail(email);
    if (!n || !isValidEmail(n)) continue;
    const userSnap = await db
      .collection("users")
      .where("email", "==", n)
      .limit(3)
      .get()
      .catch(() => null);
    let uid: string | null = null;
    let role: string | null = null;
    if (userSnap && !userSnap.empty) {
      for (const d of userSnap.docs) {
        const u = d.data() as Record<string, unknown>;
        if (String(u.companyId ?? "") === input.companyId) {
          uid = d.id;
          role = String(u.role ?? "");
          break;
        }
      }
    }
    if (uid === actorUid) continue;
    out.set(n, { email: n, uid, role, kind: "module" });
  }
}

async function addEmployeeRecipients(
  db: Firestore,
  out: Map<string, Recipient>,
  input: JobActivityNotifyInput,
  folder: Record<string, unknown> | null,
  requireFolder: boolean
): Promise<void> {
  const folderId = input.folderId?.trim() || null;
  if (requireFolder && !folderId) return;
  if (requireFolder && folder && !isFolderEmployeeVisible(folder)) return;

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
    if (!uid || uid === input.actorUid) continue;
    if (!employeeCanSeeFolder(folder, folderId, m, requireFolder)) continue;

    const uSnap = await db.collection("users").doc(uid).get();
    const u = uSnap.data() as Record<string, unknown> | undefined;
    if (!u || String(u.role ?? "") !== "employee") continue;
    const email = normalizeEmail(u.email);
    if (!email || !isValidEmail(email)) continue;
    out.set(email, { email, uid, role: "employee", kind: "employee" });
  }
}

async function addCustomerRecipients(
  db: Firestore,
  out: Map<string, Recipient>,
  input: JobActivityNotifyInput,
  job: Record<string, unknown>,
  folder: Record<string, unknown> | null,
  requireFolder: boolean
): Promise<void> {
  if (!customerMayReceiveForFolder(folder, input, requireFolder)) return;

  const jobWithId = { ...job, id: input.jobId };
  const seenUids = new Set<string>();

  const portalIds = Array.isArray(job.customerPortalUserIds)
    ? (job.customerPortalUserIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  for (const uid of portalIds) {
    if (!uid.trim() || uid === input.actorUid || seenUids.has(uid)) continue;
    const uSnap = await db.collection("users").doc(uid.trim()).get();
    const u = uSnap.data() as Record<string, unknown> | undefined;
    if (!u || String(u.role ?? "") !== "customer") continue;
    if (!canCustomerAccessJob(uid, u, jobWithId)) continue;
    const email = normalizeEmail(u.email);
    if (!email || !isValidEmail(email)) continue;
    seenUids.add(uid);
    out.set(email, { email, uid, role: "customer", kind: "customer" });
  }

  const customersSnap = await db
    .collection("users")
    .where("companyId", "==", input.companyId)
    .where("role", "==", "customer")
    .get()
    .catch(() => null);

  if (customersSnap) {
    for (const docSnap of customersSnap.docs) {
      const uid = docSnap.id;
      if (uid === input.actorUid || seenUids.has(uid)) continue;
      const u = docSnap.data() as Record<string, unknown>;
      if (!canCustomerAccessJob(uid, u, jobWithId)) continue;
      const email = normalizeEmail(u.email);
      if (!email || !isValidEmail(email)) continue;
      seenUids.add(uid);
      out.set(email, { email, uid, role: "customer", kind: "customer" });
    }
  }

  const fallbackEmail = await resolveCustomerEmailForJob({
    db,
    companyId: input.companyId,
    job,
  });
  if (fallbackEmail && isValidEmail(fallbackEmail) && !out.has(fallbackEmail)) {
    out.set(fallbackEmail, {
      email: fallbackEmail,
      role: "customer",
      kind: "customer",
    });
  }
}

/** Chat u celé zakázky (bez složky) — zaměstnanci přiřazení k zakázce. */
async function addJobWideEmployeeRecipients(
  db: Firestore,
  out: Map<string, Recipient>,
  input: JobActivityNotifyInput
): Promise<void> {
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
    if (!uid || uid === input.actorUid) continue;
    const perms = m.jobPermissions as { canViewJobOverview?: boolean } | undefined;
    if (perms?.canViewJobOverview === false) continue;

    const uSnap = await db.collection("users").doc(uid).get();
    const u = uSnap.data() as Record<string, unknown> | undefined;
    if (!u || String(u.role ?? "") !== "employee") continue;
    const email = normalizeEmail(u.email);
    if (!email || !isValidEmail(email)) continue;
    out.set(email, { email, uid, role: "employee", kind: "employee" });
  }
}

async function resolveRecipients(
  db: Firestore,
  input: JobActivityNotifyInput,
  job: Record<string, unknown>,
  folder: Record<string, unknown> | null
): Promise<Recipient[]> {
  const out = new Map<string, Recipient>();
  const requireFolder = requiresFolderAccess(input);
  const actorRole = String(input.actorRole ?? "").trim();

  await addModuleRecipients(db, out, input, input.actorUid);

  if (requireFolder) {
    await addEmployeeRecipients(db, out, input, folder, true);
    if (actorRole !== "customer") {
      await addCustomerRecipients(db, out, input, job, folder, true);
    }
  } else if (input.eventType === "job_chat") {
    await addJobWideEmployeeRecipients(db, out, input);
    if (actorRole !== "customer") {
      await addCustomerRecipients(db, out, input, job, null, false);
    }
  } else {
    await addEmployeeRecipients(db, out, input, folder, false);
    if (
      input.eventType === "customer_drawing_reminder" ||
      input.eventType === "drawing_approved" ||
      input.eventType === "drawing_rejected"
    ) {
      // zákazník provedl akci → notifikovat tým
    } else if (actorRole !== "customer") {
      await addCustomerRecipients(db, out, input, job, folder, false);
    }
  }

  if (actorRole === "customer") {
    await addEmployeeRecipients(db, out, input, folder, requireFolder);
    await addJobWideEmployeeRecipients(db, out, input);
  }

  const actorSnap = await db.collection("users").doc(input.actorUid).get();
  const actorEmail = normalizeEmail(
    (actorSnap.data() as { email?: string } | undefined)?.email
  );
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
  return (
    String(job.customerName ?? job.clientName ?? "").trim() || "—"
  );
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
