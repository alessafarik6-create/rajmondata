import { isValidEmail, normalizeEmail } from "@/lib/customer-portal-email";
import {
  dedupeRecipientRows,
  mergeRecipientLists,
  type JobNotificationRecipient,
} from "@/lib/job-notification-recipients";
import { toArraySafe } from "@/lib/to-array-safe";

export type JobMemberRow = {
  authUserId?: string;
  displayName?: string;
  name?: string;
  email?: string;
  role?: string;
};

export type UserRow = {
  id: string;
  email?: string;
  displayName?: string;
  name?: string;
  role?: string;
};

function displayNameFromUser(u: {
  displayName?: string;
  name?: string;
  email?: string;
}): string {
  return (
    String(u.displayName ?? "").trim() ||
    String(u.name ?? "").trim() ||
    String(u.email ?? "").trim() ||
    "Uživatel"
  );
}

const PRIVILEGED_ROLES = new Set([
  "owner",
  "admin",
  "manager",
  "accountant",
  "super_admin",
]);

export function buildEmployeeRecipientCandidates(
  members: JobMemberRow[],
  usersByUid: Map<string, UserRow>
): JobNotificationRecipient[] {
  const out: JobNotificationRecipient[] = [];
  for (const m of toArraySafe<JobMemberRow>(members)) {
    const uid = String(m.authUserId ?? "").trim();
    if (!uid) continue;
    const u = usersByUid.get(uid);
    const email = normalizeEmail(u?.email ?? m.email);
    if (!email || !isValidEmail(email)) continue;
    if (String(u?.role ?? m.role ?? "") !== "employee") continue;
    out.push({
      type: "employee",
      id: uid,
      name: displayNameFromUser(u ?? m),
      email,
      role: "employee",
      enabled: true,
    });
  }
  return dedupeRecipientRows(out);
}

export function buildAdminRecipientCandidates(users: UserRow[]): JobNotificationRecipient[] {
  const out: JobNotificationRecipient[] = [];
  for (const u of toArraySafe<UserRow>(users)) {
    const role = String(u.role ?? "").trim();
    if (!PRIVILEGED_ROLES.has(role)) continue;
    const email = normalizeEmail(u.email);
    if (!email || !isValidEmail(email)) continue;
    out.push({
      type: "admin",
      id: u.id,
      name: displayNameFromUser(u),
      email,
      role,
      enabled: true,
    });
  }
  return dedupeRecipientRows(out);
}

export function buildCustomerRecipientCandidates(
  candidates: Array<{
    uid?: string | null;
    email?: string | null;
    name?: string | null;
  }>
): JobNotificationRecipient[] {
  const out: JobNotificationRecipient[] = [];
  for (const c of toArraySafe(candidates)) {
    const email = normalizeEmail(c.email);
    if (!email || !isValidEmail(email)) continue;
    out.push({
      type: "customer",
      id: c.uid?.trim() || null,
      name: c.name?.trim() || email,
      email,
      role: "customer",
      enabled: true,
    });
  }
  return dedupeRecipientRows(out);
}

export function mergeFolderRecipientsForVisibility(
  existing: JobNotificationRecipient[],
  opts: {
    employeeVisible: boolean;
    customerVisible: boolean;
    internalOnly: boolean;
    employeeCandidates: JobNotificationRecipient[];
    customerCandidates: JobNotificationRecipient[];
  }
): JobNotificationRecipient[] {
  let rows = [...toArraySafe<JobNotificationRecipient>(existing)];

  if (opts.employeeVisible) {
    rows = mergeRecipientLists(rows, opts.employeeCandidates, { defaultEnabled: true });
  } else {
    rows = rows.map((r) =>
      r.type === "employee" ? { ...r, enabled: false } : r
    );
  }

  if (opts.customerVisible && !opts.internalOnly) {
    rows = mergeRecipientLists(rows, opts.customerCandidates, { defaultEnabled: true });
  } else {
    rows = rows.map((r) =>
      r.type === "customer" ? { ...r, enabled: false } : r
    );
  }

  return dedupeRecipientRows(rows);
}

export function createCustomEmailRecipient(email: string): JobNotificationRecipient | null {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) return null;
  return {
    type: "custom_email",
    id: `custom:${normalized}`,
    name: normalized,
    email: normalized,
    role: "custom",
    enabled: true,
  };
}

export function buildDefaultInternalChatRecipients(
  employeeCandidates: JobNotificationRecipient[] | unknown,
  adminCandidates: JobNotificationRecipient[] | unknown
): JobNotificationRecipient[] {
  return dedupeRecipientRows([
    ...toArraySafe<JobNotificationRecipient>(adminCandidates).map((r) => ({
      ...r,
      enabled: true,
    })),
    ...toArraySafe<JobNotificationRecipient>(employeeCandidates).map((r) => ({
      ...r,
      enabled: true,
    })),
  ]);
}

export function buildDefaultCustomerChatRecipients(
  customerCandidates: JobNotificationRecipient[] | unknown,
  adminCandidates: JobNotificationRecipient[] | unknown
): JobNotificationRecipient[] {
  return dedupeRecipientRows([
    ...toArraySafe<JobNotificationRecipient>(customerCandidates).map((r) => ({
      ...r,
      enabled: true,
    })),
    ...toArraySafe<JobNotificationRecipient>(adminCandidates).map((r) => ({
      ...r,
      enabled: true,
    })),
  ]);
}
