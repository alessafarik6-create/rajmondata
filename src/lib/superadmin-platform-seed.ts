import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  DEFAULT_PLATFORM_MODULES,
  PLATFORM_SETTINGS_DOC,
  PLATFORM_SEO_DOC,
} from "@/lib/platform-config";
import {
  PLATFORM_MODULES_COLLECTION,
  PLATFORM_SETTINGS_COLLECTION,
  PLATFORM_SEO_COLLECTION,
} from "@/lib/firestore-collections";

export async function ensurePlatformModulesSeeded(db: Firestore): Promise<void> {
  const col = db.collection(PLATFORM_MODULES_COLLECTION);
  const snap = await col.limit(1).get();
  if (!snap.empty) return;

  const batch = db.batch();
  for (const m of DEFAULT_PLATFORM_MODULES) {
    const ref = col.doc(m.code);
    batch.set(ref, {
      ...m,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function ensurePlatformSettingsSeeded(db: Firestore): Promise<void> {
  const ref = db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_SETTINGS_DOC);
  const snap = await ref.get();
  if (snap.exists) return;
  await ref.set({
    defaultEmployeePriceCzk: 49,
    landingHeadline: "Moderní provoz firmy na jedné platformě",
    landingSubline: "Docházka, zakázky, fakturace a další — od 49 Kč za zaměstnance.",
    promoNote: "Ceny bez DPH. Aktivace modulů po schválení.",
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function ensurePlatformSeoSeeded(db: Firestore): Promise<void> {
  const ref = db.collection(PLATFORM_SEO_COLLECTION).doc(PLATFORM_SEO_DOC);
  const snap = await ref.get();
  if (snap.exists) return;
  await ref.set({
    pageKey: "home",
    metaTitle: "Rajmondata — provoz firmy, docházka, zakázky",
    metaDescription: "Cloudová platforma pro firmy: docházka a mzdy od 49 Kč, zakázky, fakturace.",
    keywords: "docházka, mzdy, zakázky, fakturace, firma, cloud",
    ogTitle: "Rajmondata",
    ogDescription: "Docházka, práce a mzdy od 49 Kč. Moduly dle potřeby.",
    canonicalUrl: "",
    landingLead: "Spojte tým, zakázky a finance v jednom přehledném systému.",
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function ensureAllPlatformData(db: Firestore): Promise<void> {
  await ensurePlatformModulesSeeded(db);
  await ensurePlatformSettingsSeeded(db);
  await ensurePlatformSeoSeeded(db);
}
