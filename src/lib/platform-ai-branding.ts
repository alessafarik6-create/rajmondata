import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { PLATFORM_SETTINGS_COLLECTION } from "@/lib/firestore-collections";
import {
  DEFAULT_PLATFORM_AI_BRANDING,
  PLATFORM_AI_BRANDING_DOC,
  type PlatformAiBranding,
} from "@/lib/platform-ai-branding-shared";

export type { PlatformAiBranding } from "@/lib/platform-ai-branding-shared";
export { PLATFORM_AI_BRANDING_DOC, DEFAULT_PLATFORM_AI_BRANDING } from "@/lib/platform-ai-branding-shared";

function brandingRef(db: Firestore) {
  return db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_AI_BRANDING_DOC);
}

export async function loadPlatformAiBranding(db: Firestore): Promise<PlatformAiBranding> {
  const snap = await brandingRef(db).get();
  if (!snap.exists) return { ...DEFAULT_PLATFORM_AI_BRANDING };
  const d = snap.data() as Record<string, unknown>;
  return {
    assistantName: String(d.assistantName ?? DEFAULT_PLATFORM_AI_BRANDING.assistantName).slice(0, 80),
    assistantSubtitle: String(d.assistantSubtitle ?? DEFAULT_PLATFORM_AI_BRANDING.assistantSubtitle).slice(
      0,
      120
    ),
    avatarUrl: d.avatarUrl ? String(d.avatarUrl) : null,
    avatarStoragePath: d.avatarStoragePath ? String(d.avatarStoragePath) : null,
    updatedAt: d.updatedAt,
    updatedBy: d.updatedBy != null ? String(d.updatedBy) : null,
  };
}

export async function savePlatformAiBranding(
  db: Firestore,
  patch: Partial<PlatformAiBranding> & { updatedBy: string }
): Promise<void> {
  const body: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: patch.updatedBy,
  };
  if (patch.assistantName != null) body.assistantName = patch.assistantName.slice(0, 80);
  if (patch.assistantSubtitle != null) body.assistantSubtitle = patch.assistantSubtitle.slice(0, 120);
  if (patch.avatarUrl !== undefined) body.avatarUrl = patch.avatarUrl;
  if (patch.avatarStoragePath !== undefined) body.avatarStoragePath = patch.avatarStoragePath;
  await brandingRef(db).set(body, { merge: true });
}
