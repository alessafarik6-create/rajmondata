import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { PLATFORM_SETTINGS_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_SETTINGS_DOC } from "@/lib/platform-config";

export const PLATFORM_AI_BRANDING_DOC = "aiAssistant";

export type PlatformAiBranding = {
  assistantName: string;
  assistantSubtitle: string;
  avatarUrl: string | null;
  avatarStoragePath: string | null;
  updatedAt?: unknown;
  updatedBy?: string | null;
};

const DEFAULTS: PlatformAiBranding = {
  assistantName: "RAJMONDATA AI",
  assistantSubtitle: "Vaše firemní sekretářka",
  avatarUrl: null,
  avatarStoragePath: null,
};

function brandingRef(db: Firestore) {
  return db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_AI_BRANDING_DOC);
}

export async function loadPlatformAiBranding(db: Firestore): Promise<PlatformAiBranding> {
  const snap = await brandingRef(db).get();
  if (!snap.exists) return { ...DEFAULTS };
  const d = snap.data() as Record<string, unknown>;
  return {
    assistantName: String(d.assistantName ?? DEFAULTS.assistantName).slice(0, 80),
    assistantSubtitle: String(d.assistantSubtitle ?? DEFAULTS.assistantSubtitle).slice(0, 120),
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

export { DEFAULTS as DEFAULT_PLATFORM_AI_BRANDING };
