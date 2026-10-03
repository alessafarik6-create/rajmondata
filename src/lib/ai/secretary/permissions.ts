import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
import {
  resolveCalendarPermissions,
  type CalendarPermissionsResolved,
} from "@/lib/calendar/calendar-access";
import { resolveEffectivePortalPermissions } from "@/lib/portal-permissions";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export type SecretaryToolPermission =
  | "calendar_read"
  | "calendar_write"
  | "jobs_read"
  | "jobs_write"
  | "customers_read"
  | "email_read"
  | "email_write"
  | "tasks_write";

export type SecretaryPermissions = {
  calendar: CalendarPermissionsResolved;
  canReadCalendar: boolean;
  canWriteCalendarMeetings: boolean;
  canReadJobs: boolean;
  canWriteJobs: boolean;
  canReadCustomers: boolean;
  canReadEmail: boolean;
  canWriteEmail: boolean;
  canWriteTasks: boolean;
};

async function loadEmployeeDoc(
  db: Firestore,
  caller: VerifiedCompanyCaller
): Promise<Record<string, unknown> | null> {
  const userSnap = await db.collection("users").doc(caller.uid).get();
  const eid = String((userSnap.data() as { employeeId?: string } | undefined)?.employeeId ?? "").trim();
  if (!eid) return null;
  const empSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(caller.companyId)
    .collection("employees")
    .doc(eid)
    .get();
  return empSnap.exists ? (empSnap.data() as Record<string, unknown>) : null;
}

export async function resolveSecretaryPermissions(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  companyId: string
): Promise<SecretaryPermissions> {
  const employeeDoc = await loadEmployeeDoc(db, caller);
  const calendar = resolveCalendarPermissions({
    role: caller.role,
    globalRoles: caller.globalRoles,
    employeeDoc,
  });
  const portal = resolveEffectivePortalPermissions({
    role: caller.role,
    employeeDoc,
    globalRoles: caller.globalRoles,
  });

  return {
    calendar,
    canReadCalendar: calendar.anyView,
    canWriteCalendarMeetings: calendar.meetings.write,
    canReadJobs: portal.jobs === "read" || portal.jobs === "write",
    canWriteJobs: portal.jobs === "write",
    canReadCustomers: portal.customers === "read" || portal.customers === "write",
    canReadEmail: portal.emails === "read" || portal.emails === "write",
    canWriteEmail: portal.emails === "write",
    canWriteTasks: portal.jobs === "write" || caller.role === "owner" || caller.role === "admin",
  };
}

export function assertSecretaryPermission(
  perms: SecretaryPermissions,
  need: SecretaryToolPermission
): { ok: true } | { ok: false; message: string } {
  switch (need) {
    case "calendar_read":
      return perms.canReadCalendar
        ? { ok: true }
        : { ok: false, message: "Do kalendáře nemáte oprávnění nahlížet." };
    case "calendar_write":
      return perms.canWriteCalendarMeetings
        ? { ok: true }
        : { ok: false, message: "Do kalendáře nemáte oprávnění zapisovat." };
    case "jobs_read":
      return perms.canReadJobs
        ? { ok: true }
        : { ok: false, message: "K zakázkám nemáte přístup." };
    case "jobs_write":
      return perms.canWriteJobs
        ? { ok: true }
        : { ok: false, message: "Zakázky nemůžete upravovat." };
    case "customers_read":
      return perms.canReadCustomers
        ? { ok: true }
        : { ok: false, message: "K zákazníkům nemáte přístup." };
    case "email_read":
      return perms.canReadEmail
        ? { ok: true }
        : { ok: false, message: "K e-mailům nemáte přístup." };
    case "email_write":
      return perms.canWriteEmail
        ? { ok: true }
        : { ok: false, message: "E-maily nemůžete odesílat ani tvořit koncepty." };
    case "tasks_write":
      return perms.canWriteTasks
        ? { ok: true }
        : { ok: false, message: "Úkoly nemůžete vytvářet." };
    default:
      return { ok: false, message: "Neznámé oprávnění." };
  }
}
