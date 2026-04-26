import { getAdminStorageBucket } from "@/lib/firebase-admin";

/** Načte binární PDF platformní faktury z veřejné URL nebo ze Storage (Admin). */
export async function loadPlatformInvoicePdfBufferAdmin(d: Record<string, unknown>): Promise<Buffer> {
  const pdfUrl = typeof d.pdfUrl === "string" && d.pdfUrl.trim() ? d.pdfUrl.trim() : "";
  if (pdfUrl) {
    const r = await fetch(pdfUrl);
    if (!r.ok) throw new Error(`Stažení PDF selhalo (HTTP ${r.status}).`);
    return Buffer.from(await r.arrayBuffer());
  }
  const path = typeof d.storagePath === "string" && d.storagePath.trim() ? d.storagePath.trim() : "";
  const bucket = getAdminStorageBucket();
  if (!bucket || !path) throw new Error("PDF není uloženo.");
  const [buf] = await bucket.file(path).download();
  return buf;
}
