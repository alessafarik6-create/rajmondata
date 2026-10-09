import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { parseEmployeeOrgRole, userPortalRoleForEmployeeDocRole } from "@/lib/employee-organization";
import {
  buildNewPortalPreviewSession,
  portalPreviewSessionFromFirestore,
  type PortalPreviewSessionDoc,
} from "@/lib/portal-preview";

export type PortalPreviewCallerMeta = {
  active: true;
  subjectEmployeeId: string;
  subjectDisplayName: string;
  realRole: string;
  realEmployeeId: string | null;
};

export type VerifiedCompanyCallerWithPreview = VerifiedCompanyCaller & {
  portalPreview?: PortalPreviewCallerMeta;
  /** Původní role před náhledem (shodná s realRole v meta). */
  realRole?: string;
  realEmployeeId?: string | null;
};

export async function loadUserPortalPreviewSession(
  db: Firestore,
  uid: string
): Promise<PortalPreviewSessionDoc | null> {
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.data() as Record<string, unknown> | undefined;
  if (!data) return null;
  return portalPreviewSessionFromFirestore(data.portalPreviewSession);
}

export async function applyPortalPreviewToCaller(
  db: Firestore,
  caller: VerifiedCompanyCaller
): Promise<VerifiedCompanyCallerWithPreview> {
  const session = await loadUserPortalPreviewSession(db, caller.uid);
  if (!session || session.companyId !== caller.companyId) {
    return caller;
  }

  const empSnap = await db
    .collection("companies")
    .doc(session.companyId)
    .collection("employees")
    .doc(session.employeeId)
    .get();
  if (!empSnap.exists) {
    return caller;
  }
  const emp = empSnap.data() as Record<string, unknown>;
  if (String(emp.companyId || session.companyId) !== session.companyId) {
    return caller;
  }

  const orgRole = parseEmployeeOrgRole(emp as { role?: unknown });
  const portalRole = userPortalRoleForEmployeeDocRole(orgRole);

  return {
    ...caller,
    realRole: caller.role,
    realEmployeeId: caller.employeeId,
    role: portalRole,
    employeeId: session.employeeId,
    portalPreview: {
      active: true,
      subjectEmployeeId: session.employeeId,
      subjectDisplayName: session.displayName,
      realRole: caller.role,
      realEmployeeId: caller.employeeId,
    },
  };
}

export function portalPreviewBlocksMutation(
  caller: VerifiedCompanyCallerWithPreview,
  opts?: { allowPreviewEnd?: boolean; pathname?: string }
): boolean {
  if (!caller.portalPreview?.active) return false;
  if (opts?.allowPreviewEnd && String(opts.pathname ?? "").includes("/portal-preview/end")) {
    return false;
  }
  return true;
}

export async function writePortalPreviewAudit(
  db: Firestore,
  params: {
    companyId: string;
    adminUid: string;
    employeeId: string;
    displayName: string;
    action: "PORTAL_PREVIEW_STARTED" | "PORTAL_PREVIEW_ENDED";
  }
) {
  try {
    await db.collection("companies").doc(params.companyId).collection("activity_log").add({
      actionType: params.action,
      actionLabel:
        params.action === "PORTAL_PREVIEW_STARTED"
          ? "Náhled portálu jako zaměstnanec — start"
          : "Náhled portálu jako zaměstnanec — konec",
      entityType: "employee",
      entityId: params.employeeId,
      details: JSON.stringify({
        employeeId: params.employeeId,
        displayName: params.displayName,
        adminUid: params.adminUid,
      }),
      createdBy: params.adminUid,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    /* audit best-effort */
  }
}

export { buildNewPortalPreviewSession };
