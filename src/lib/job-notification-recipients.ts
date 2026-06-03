/**
 * E-mailoví příjemci u složek zakázky a chatů (konkrétní seznam, ne globální rozesílka).
 */

import type { Firestore } from "firebase-admin/firestore";
import { isValidEmail, normalizeEmail } from "@/lib/customer-portal-email";
import {
  canCustomerAccessJob,
  isFolderCustomerVisible,
  isFolderInternalOnly,
} from "@/lib/job-customer-access";
import { isFolderEmployeeVisible } from "@/lib/job-employee-access";
import { toArraySafe } from "@/lib/to-array-safe";

export type JobNotificationRecipientType =
  | "employee"
  | "customer"
  | "admin"
  | "custom_email";

export type JobNotificationRecipient = {
  type: JobNotificationRecipientType;
  id?: string | null;
  name?: string | null;
  email: string;
  role?: string | null;
  enabled: boolean;
};

export type ResolvedEmailRecipient = {
  email: string;
  uid?: string | null;
  role?: string | null;
  kind: JobNotificationRecipientType;
  name?: string | null;
};

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function recipientRowKey(r: Pick<JobNotificationRecipient, "type" | "id" | "email">): string {
  const email = normalizeEmail(r.email) || r.email.trim().toLowerCase();
  const id = trimStr(r.id);
  return `${r.type}|${id || email}`;
}

export function parseNotificationRecipients(raw: unknown): JobNotificationRecipient[] {
  const out: JobNotificationRecipient[] = [];
  for (const row of toArraySafe<unknown>(raw)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const type = trimStr(o.type) as JobNotificationRecipientType;
    if (!["employee", "customer", "admin", "custom_email"].includes(type)) continue;
    const email = normalizeEmail(o.email) || trimStr(o.email);
    if (!email || !isValidEmail(email)) continue;
    out.push({
      type,
      id: trimStr(o.id) || null,
      name: trimStr(o.name) || null,
      email,
      role: trimStr(o.role) || null,
      enabled: o.enabled !== false,
    });
  }
  return dedupeRecipientRows(out);
}

export function dedupeRecipientRows(
  rows: JobNotificationRecipient[] | unknown
): JobNotificationRecipient[] {
  const map = new Map<string, JobNotificationRecipient>();
  for (const r of toArraySafe<JobNotificationRecipient>(rows)) {
    const key = recipientRowKey(r);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, r);
      continue;
    }
    map.set(key, {
      ...prev,
      ...r,
      enabled: prev.enabled || r.enabled,
      name: r.name || prev.name,
    });
  }
  return [...map.values()];
}

export function formatNotificationRecipientsSummary(
  recipients: JobNotificationRecipient[] | unknown,
  enabled: boolean
): string {
  if (!enabled) return "Notifikace jsou vypnuté.";
  const active = toArraySafe<JobNotificationRecipient>(recipients).filter(
    (r) => r.enabled && r.email
  );
  if (!active.length) return "Notifikace zapnuté — zatím bez příjemců.";
  const labels = active.map((r) => {
    const name = trimStr(r.name);
    return name ? `${name} (${r.email})` : r.email;
  });
  return `Notifikace půjdou na: ${labels.join(", ")}`;
}

export function parseFolderEmailNotificationSettings(
  folder: Record<string, unknown> | null | undefined
): { enabled: boolean; recipients: JobNotificationRecipient[] } {
  if (!folder) return { enabled: false, recipients: [] };
  const recipients = parseNotificationRecipients(folder.notificationRecipients);
  const legacyOn =
    folder.notifyEmployees === true || folder.notifyCustomer === true;
  const enabled =
    folder.emailNotificationsEnabled !== undefined
      ? folder.emailNotificationsEnabled === true
      : legacyOn;
  return { enabled, recipients };
}

export function parseJobInternalChatNotificationSettings(
  job: Record<string, unknown> | null | undefined
): { enabled: boolean; recipients: JobNotificationRecipient[] } {
  if (!job) return { enabled: false, recipients: [] };
  const legacy = job.internalChatEmailNotifications === true;
  const recipients = parseNotificationRecipients(
    job.internalChatNotificationRecipients ??
      job.internalChatEmailNotificationRecipients
  );
  const enabled =
    job.internalChatEmailNotificationsEnabled !== undefined
      ? job.internalChatEmailNotificationsEnabled === true
      : legacy;
  return { enabled, recipients };
}

export function parseJobCustomerChatNotificationSettings(
  job: Record<string, unknown> | null | undefined
): { enabled: boolean; recipients: JobNotificationRecipient[] } {
  if (!job) return { enabled: false, recipients: [] };
  const legacy = job.customerChatEmailNotifications === true;
  const recipients = parseNotificationRecipients(
    job.customerChatNotificationRecipients ??
      job.customerChatEmailNotificationRecipients
  );
  const enabled =
    job.customerChatEmailNotificationsEnabled !== undefined
      ? job.customerChatEmailNotificationsEnabled === true
      : legacy;
  return { enabled, recipients };
}

export function mergeRecipientLists(
  existing: JobNotificationRecipient[] | unknown,
  additions: JobNotificationRecipient[] | unknown,
  opts?: { defaultEnabled?: boolean }
): JobNotificationRecipient[] {
  const map = new Map<string, JobNotificationRecipient>();
  for (const r of toArraySafe<JobNotificationRecipient>(existing)) {
    map.set(recipientRowKey(r), r);
  }
  for (const add of toArraySafe<JobNotificationRecipient>(additions)) {
    const key = recipientRowKey(add);
    const prev = map.get(key);
    if (prev) {
      map.set(key, {
        ...prev,
        name: add.name || prev.name,
        role: add.role || prev.role,
        enabled: prev.enabled || add.enabled,
      });
    } else {
      map.set(key, {
        ...add,
        enabled: add.enabled ?? opts?.defaultEnabled ?? true,
      });
    }
  }
  return dedupeRecipientRows([...map.values()]);
}

function employeeCanAccessFolder(
  folder: Record<string, unknown>,
  folderId: string,
  member: Record<string, unknown> | null
): boolean {
  if (!isFolderEmployeeVisible(folder)) return false;
  const perms = member?.jobPermissions as
    | { allowedFolderIds?: string[]; canViewPhotoFolders?: boolean }
    | undefined;
  if (perms?.canViewPhotoFolders === false) return false;
  const allowed = perms?.allowedFolderIds;
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(folderId)) {
    return false;
  }
  return true;
}

async function loadJobMemberByUid(
  db: Firestore,
  companyId: string,
  jobId: string,
  uid: string
): Promise<Record<string, unknown> | null> {
  const membersSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .doc(jobId)
    .collection("jobMembers")
    .get();
  for (const d of membersSnap.docs) {
    const m = d.data() as Record<string, unknown>;
    if (String(m.authUserId ?? "").trim() === uid) return m;
  }
  return null;
}

export async function resolveRecipientsFromConfiguredList(
  db: Firestore,
  params: {
    recipients: JobNotificationRecipient[];
    enabled: boolean;
    actorUid: string;
    companyId: string;
    jobId: string;
    job: Record<string, unknown>;
    folder?: Record<string, unknown> | null;
    folderId?: string | null;
    visibleToCustomer?: boolean | null;
    requireCustomerFolderVisibility?: boolean;
    /** Interní chat bez složky — stačí přiřazení k zakázce. */
    allowJobAssignedEmployees?: boolean;
  }
): Promise<ResolvedEmailRecipient[]> {
  if (!params.enabled) return [];

  const out = new Map<string, ResolvedEmailRecipient>();
  const folder = params.folder ?? null;
  const folderId = params.folderId?.trim() || null;

  for (const row of toArraySafe<JobNotificationRecipient>(params.recipients)) {
    if (!row.enabled) continue;
    const email = normalizeEmail(row.email);
    if (!email || !isValidEmail(email)) continue;

    if (row.type === "employee") {
      const uid = trimStr(row.id);
      if (!uid) continue;
      const member = await loadJobMemberByUid(db, params.companyId, params.jobId, uid);
      if (!member) continue;
      if (params.allowJobAssignedEmployees && (!folder || !folderId)) {
        /* interní chat — přiřazení k zakázce stačí */
      } else {
        if (!folder || !folderId) continue;
        if (!isFolderEmployeeVisible(folder)) continue;
        if (!employeeCanAccessFolder(folder, folderId, member)) continue;
      }
      out.set(email, {
        email,
        uid,
        role: "employee",
        kind: "employee",
        name: row.name ?? null,
      });
      continue;
    }

    if (row.type === "customer") {
      if (params.requireCustomerFolderVisibility && folder) {
        if (isFolderInternalOnly(folder)) continue;
        if (params.visibleToCustomer === false) continue;
        if (!isFolderCustomerVisible(folder)) continue;
      }
      const uid = trimStr(row.id);
      const jobWithId = { ...params.job, id: params.jobId };
      if (uid) {
        const uSnap = await db.collection("users").doc(uid).get();
        const u = uSnap.data() as Record<string, unknown> | undefined;
        if (!u || String(u.role ?? "") !== "customer") continue;
        if (!canCustomerAccessJob(uid, u, jobWithId)) continue;
      }
      out.set(email, {
        email,
        uid: uid || null,
        role: "customer",
        kind: "customer",
        name: row.name ?? null,
      });
      continue;
    }

    out.set(email, {
      email,
      uid: trimStr(row.id) || null,
      role: row.role ?? row.type,
      kind: row.type,
      name: row.name ?? null,
    });
  }

  const actorSnap = await db.collection("users").doc(params.actorUid).get();
  const actorEmail = normalizeEmail(
    (actorSnap.data() as { email?: string } | undefined)?.email
  );
  if (actorEmail) out.delete(actorEmail);

  return [...out.values()];
}
