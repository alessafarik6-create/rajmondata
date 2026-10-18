import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { PLATFORM_SECURITY_AUDIT_COLLECTION } from "@/lib/firestore-collections";
import type { PlatformModuleCode } from "@/lib/platform-config";
import { editorUrlsFromCatalog } from "@/lib/rajmondata-editor/config";
import { buildMergedPlatformCatalogMap } from "@/lib/platform-module-catalog";
import { PLATFORM_MODULES_COLLECTION } from "@/lib/firestore-collections";
import { syncEditorModuleAccess } from "@/lib/rajmondata-editor/editor-api-client.server";
import { listModuleUserAssignmentIds } from "@/lib/platform-module-assignments.server";

const MAX_ATTEMPTS = 4;

export type EditorSyncState = {
  editorAccessSyncPending?: boolean;
  editorAccessSyncLastError?: string | null;
  editorAccessSyncAt?: unknown;
};

async function loadApiUrl(db: Firestore, moduleCode: PlatformModuleCode): Promise<string> {
  const modSnap = await db.collection(PLATFORM_MODULES_COLLECTION).doc(moduleCode).get();
  const row = buildMergedPlatformCatalogMap(
    modSnap.exists ? [{ id: modSnap.id, ...(modSnap.data() as Record<string, unknown>) }] : []
  )[moduleCode];
  return editorUrlsFromCatalog(row).apiUrl;
}

export async function syncRajmondataEditorAccessWithRetry(input: {
  db: Firestore;
  organizationId: string;
  moduleActive: boolean;
  licenseActive: boolean;
  actor?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const orgId = input.organizationId.trim();
  const moduleCode = "rajmondata_editor" as PlatformModuleCode;
  const apiUrl = await loadApiUrl(input.db, moduleCode);
  const assigned = input.moduleActive
    ? await listModuleUserAssignmentIds(input.db, orgId, moduleCode)
    : [];
  const users = assigned.map((userId) => ({ userId, active: input.moduleActive }));

  let lastError = "Neznámá chyba";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await syncEditorModuleAccess(apiUrl, {
      organizationId: orgId,
      moduleActive: input.moduleActive,
      licenseActive: input.licenseActive,
      users,
    });
    if (res.ok) {
      await input.db.collection(PLATFORM_SECURITY_AUDIT_COLLECTION).add({
        action: "editor_access_sync_ok",
        organizationId: orgId,
        moduleActive: input.moduleActive,
        attempt,
        actor: input.actor ?? "system",
        at: FieldValue.serverTimestamp(),
      });
      return { ok: true };
    }
    lastError = res.error;
    if (res.code === "PORTAL_AUTH_NOT_CONFIGURED") break;
    await new Promise((r) => setTimeout(r, 250 * attempt));
  }

  await input.db.collection(PLATFORM_SECURITY_AUDIT_COLLECTION).add({
    action: "editor_access_sync_failed",
    organizationId: orgId,
    moduleActive: input.moduleActive,
    error: lastError,
    actor: input.actor ?? "system",
    at: FieldValue.serverTimestamp(),
  });

  return { ok: false, error: lastError };
}
