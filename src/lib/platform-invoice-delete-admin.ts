import type { Firestore } from "firebase-admin/firestore";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { PLATFORM_INVOICES_COLLECTION } from "@/lib/firestore-collections";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";

/** Smaže dokument v `platform_invoices` a případný soubor ve Storage (Admin). */
export async function deletePlatformInvoiceAdmin(db: Firestore, invoiceId: string): Promise<void> {
  const id = String(invoiceId || "").trim();
  if (!id) throw new Error("Chybí ID faktury.");
  await ensureAllPlatformData(db);
  const ref = db.collection(PLATFORM_INVOICES_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Faktura neexistuje.");
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const storagePath = typeof data.storagePath === "string" ? data.storagePath.trim() : "";
  if (storagePath) {
    try {
      const bucket = getAdminStorageBucket();
      if (bucket) await bucket.file(storagePath).delete({ ignoreNotFound: true });
    } catch (e) {
      console.warn("[deletePlatformInvoiceAdmin] storage", e);
    }
  }
  await ref.delete();
}
