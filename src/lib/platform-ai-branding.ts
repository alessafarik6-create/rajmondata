import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { PLATFORM_SETTINGS_COLLECTION } from "@/lib/firestore-collections";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import {
  DEFAULT_PLATFORM_AI_BRANDING,
  PLATFORM_AI_BRANDING_DOC,
  type PlatformAiBranding,
} from "@/lib/platform-ai-branding-shared";

export type { PlatformAiBranding } from "@/lib/platform-ai-branding-shared";
export {
  PLATFORM_AI_BRANDING_DOC,
  DEFAULT_PLATFORM_AI_BRANDING,
  PLATFORM_AI_BRANDING_CACHE_TAG,
} from "@/lib/platform-ai-branding-shared";

function brandingRef(db: Firestore) {
  return db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_AI_BRANDING_DOC);
}

function updatedAtToIso(updatedAt: unknown): string | null {
  if (!updatedAt) return null;
  if (typeof updatedAt === "string") return updatedAt;
  if (typeof updatedAt === "object" && updatedAt !== null && "toDate" in updatedAt) {
    try {
      return (updatedAt as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof updatedAt === "object" && updatedAt !== null && "_seconds" in updatedAt) {
    const sec = Number((updatedAt as { _seconds: number })._seconds);
    if (!Number.isNaN(sec)) return new Date(sec * 1000).toISOString();
  }
  return null;
}

async function resolveAvatarPublicUrl(
  branding: Pick<PlatformAiBranding, "avatarUrl" | "avatarStoragePath">
): Promise<string | null> {
  const direct = branding.avatarUrl?.trim();
  if (direct?.startsWith("http://") || direct?.startsWith("https://")) {
    return direct;
  }
  const path = branding.avatarStoragePath?.trim();
  if (!path) return direct || null;

  const bucket = getAdminStorageBucket();
  if (!bucket) return direct || null;

  try {
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) return direct || null;
    const [signed] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    return signed;
  } catch {
    if (direct) return direct;
    return `https://storage.googleapis.com/${bucket.name}/${path}`;
  }
}

/** Jednotný server-side source of truth pro globální AI branding. */
export async function getPlatformAiBranding(db: Firestore): Promise<PlatformAiBranding> {
  return loadPlatformAiBranding(db);
}

export async function loadPlatformAiBranding(db: Firestore): Promise<PlatformAiBranding> {
  const snap = await brandingRef(db).get();
  if (!snap.exists) return { ...DEFAULT_PLATFORM_AI_BRANDING };
  const d = snap.data() as Record<string, unknown>;
  const base: PlatformAiBranding = {
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
  const resolvedAvatar = await resolveAvatarPublicUrl(base);
  return {
    ...base,
    avatarUrl: resolvedAvatar,
    updatedAt: updatedAtToIso(base.updatedAt) ?? base.updatedAt,
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
