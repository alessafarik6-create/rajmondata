import type { Firestore } from "firebase-admin/firestore";
import { PLATFORM_SETTINGS_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_BILLING_PROVIDER_DOC } from "@/lib/platform-config";

export function isValidPlatformContactEmail(email: string): boolean {
  const e = email.trim();
  return e.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/** E-mail provozovatele z platform_settings/billingProvider (bez hardcodu). */
export async function loadPlatformProviderContactEmail(
  db: Firestore
): Promise<string | null> {
  const snap = await db
    .collection(PLATFORM_SETTINGS_COLLECTION)
    .doc(PLATFORM_BILLING_PROVIDER_DOC)
    .get();
  if (!snap.exists) return null;
  const email = String((snap.data() as { email?: unknown })?.email ?? "").trim();
  if (!isValidPlatformContactEmail(email)) return null;
  return email;
}
