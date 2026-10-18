import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  MODULE_USER_ASSIGNMENTS_SUBCOLLECTION,
  PLATFORM_MODULE_LAUNCH_AUDIT_COLLECTION,
  PLATFORM_SECURITY_AUDIT_COLLECTION,
  PLATFORM_MODULES_COLLECTION,
} from "@/lib/firestore-collections";
import type { PlatformModuleCode } from "@/lib/platform-config";
import { revokeEditorAccess } from "@/lib/rajmondata-editor/editor-api-client.server";
import { buildMergedPlatformCatalogMap } from "@/lib/platform-module-catalog";

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
}

export async function suspendModuleForOrganization(input: {
  db: Firestore;
  organizationId: string;
  moduleCode: PlatformModuleCode;
  actor: string;
  reason: string;
}): Promise<void> {
  const modSnap = await input.db.collection(PLATFORM_MODULES_COLLECTION).doc(input.moduleCode).get();
  const row = buildMergedPlatformCatalogMap(
    modSnap.exists ? [{ id: modSnap.id, ...(modSnap.data() as Record<string, unknown>) }] : []
  )[input.moduleCode];
  if (row?.apiUrl) {
    await revokeEditorAccess({
      apiUrl: row.apiUrl,
      organizationId: input.organizationId,
      userId: null,
      reason: input.reason,
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
