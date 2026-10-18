import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  MODULE_USER_ASSIGNMENTS_SUBCOLLECTION,
  PLATFORM_MODULE_LAUNCH_AUDIT_COLLECTION,
  PLATFORM_SECURITY_AUDIT_COLLECTION,
} from "@/lib/firestore-collections";
import type { PlatformModuleCode } from "@/lib/platform-config";
import { syncRajmondataEditorAccessWithRetry } from "@/lib/rajmondata-editor/editor-access-sync.server";
import { ensureCompanyLicenseDoc, writeCompanyLicenseAndDenorm } from "@/lib/company-license-admin";

function assignmentDocId(userId: string, moduleCode: string): string {
  return `${userId}_${moduleCode}`;
}

export async function listModuleUserAssignmentIds(
  db: Firestore,
  organizationId: string,
  moduleCode: PlatformModuleCode
): Promise<string[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(organizationId)
    .collection(MODULE_USER_ASSIGNMENTS_SUBCOLLECTION)
    .where("moduleCode", "==", moduleCode)
    .where("active", "==", true)
    .get();
  return snap.docs.map((d) => String((d.data() as { userId?: string }).userId ?? "")).filter(Boolean);
}

export async function setModuleUserAssignment(input: {
  db: Firestore;
  organizationId: string;
  moduleCode: PlatformModuleCode;
  userId: string;
  active: boolean;
  actor: string;
}): Promise<void> {
  const ref = input.db
    .collection(COMPANIES_COLLECTION)
    .doc(input.organizationId)
    .collection(MODULE_USER_ASSIGNMENTS_SUBCOLLECTION)
    .doc(assignmentDocId(input.userId, input.moduleCode));
  if (input.active) {
    await ref.set(
      {
        userId: input.userId,
        moduleCode: input.moduleCode,
        active: true,
        assignedAt: FieldValue.serverTimestamp(),
        assignedBy: input.actor,
      },
      { merge: true }
    );
  } else {
    await ref.set(
      { active: false, revokedAt: FieldValue.serverTimestamp(), revokedBy: input.actor },
      { merge: true }
    );
  }
  await input.db.collection(PLATFORM_SECURITY_AUDIT_COLLECTION).add({
    action: input.active ? "module_user_assigned" : "module_user_revoked",
    organizationId: input.organizationId,
    moduleCode: input.moduleCode,
    userId: input.userId,
    actor: input.actor,
    at: FieldValue.serverTimestamp(),
  });

  if (input.moduleCode === "rajmondata_editor") {
    const lic = await ensureCompanyLicenseDoc(input.db, input.organizationId);
    const ent = lic.modules.rajmondata_editor;
    const moduleActive = Boolean(ent?.active && ent.tenantModuleStatus !== "suspended");
    const sync = await syncRajmondataEditorAccessWithRetry({
      db: input.db,
      organizationId: input.organizationId,
      moduleActive,
      licenseActive: moduleActive,
      actor: input.actor,
    });
    await writeCompanyLicenseAndDenorm(input.db, input.organizationId, {
      ...lic,
      editorAccessSyncPending: !sync.ok,
      editorAccessSyncLastError: sync.ok ? null : sync.error,
    });
  }
}

export async function suspendModuleForOrganization(input: {
  db: Firestore;
  organizationId: string;
  moduleCode: PlatformModuleCode;
  actor: string;
  reason: string;
}): Promise<void> {
  if (input.moduleCode === "rajmondata_editor") {
    const sync = await syncRajmondataEditorAccessWithRetry({
      db: input.db,
      organizationId: input.organizationId,
      moduleActive: false,
      licenseActive: false,
      actor: input.actor,
    });
    const lic = await ensureCompanyLicenseDoc(input.db, input.organizationId);
    await writeCompanyLicenseAndDenorm(input.db, input.organizationId, {
      ...lic,
      editorAccessSyncPending: !sync.ok,
      editorAccessSyncLastError: sync.ok ? null : sync.error,
    });
  }
  await input.db.collection(PLATFORM_MODULE_LAUNCH_AUDIT_COLLECTION).add({
    organizationId: input.organizationId,
    moduleCode: input.moduleCode,
    action: "suspended",
    reason: input.reason,
    actor: input.actor,
    at: FieldValue.serverTimestamp(),
  });
}
