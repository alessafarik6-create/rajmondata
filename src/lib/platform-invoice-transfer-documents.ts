/**
 * Přenesení PDF platformní faktury do firemních dokladů (companies/{id}/documents).
 */
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";
import { COMPANIES_COLLECTION, PLATFORM_INVOICES_COLLECTION } from "@/lib/firestore-collections";
import { loadPlatformInvoicePdfBufferAdmin } from "@/lib/platform-invoice-pdf-buffer";

export type TransferPlatformInvoiceResult =
  | { ok: true; documentId: string; alreadyTransferred: boolean }
  | { ok: false; status: number; error: string };

function safeFileBase(name: string, fallback: string): string {
  const t = name.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").trim();
  return t.slice(0, 80) || fallback;
}

export async function transferPlatformInvoiceToCompanyDocuments(input: {
  db: Firestore;
  bucket: Bucket;
  organizationId: string;
  invoiceId: string;
  actorUid: string;
}): Promise<TransferPlatformInvoiceResult> {
  const orgId = String(input.organizationId || "").trim();
  const invoiceId = String(input.invoiceId || "").trim();
  if (!orgId || !invoiceId) {
    return { ok: false, status: 400, error: "Chybí organizationId nebo invoiceId." };
  }

  const invRef = input.db.collection(PLATFORM_INVOICES_COLLECTION).doc(invoiceId);
  const invSnap = await invRef.get();
  if (!invSnap.exists) {
    return { ok: false, status: 404, error: "Faktura neexistuje." };
  }
  const data = (invSnap.data() ?? {}) as Record<string, unknown>;
  if (String(data.organizationId || "").trim() !== orgId) {
    return { ok: false, status: 403, error: "Faktura nepatří této organizaci." };
  }

  const existingOnInvoice = String(data.transferredToDocumentId || "").trim();
  if (existingOnInvoice) {
    return { ok: true, documentId: existingOnInvoice, alreadyTransferred: true };
  }

  const docsCol = input.db.collection(COMPANIES_COLLECTION).doc(orgId).collection("documents");
  const dupSnap = await docsCol.where("sourceInvoiceId", "==", invoiceId).limit(8).get();
  for (const q of dupSnap.docs) {
    const row = q.data() as { isDeleted?: boolean };
    if (row.isDeleted === true) continue;
    await invRef.set(
      { transferredToDocumentId: q.id, transferredToDocumentsAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { ok: true, documentId: q.id, alreadyTransferred: true };
  }

  const hasPdf =
    (typeof data.pdfUrl === "string" && data.pdfUrl.trim()) ||
    (typeof data.storagePath === "string" && data.storagePath.trim());
  if (!hasPdf) {
    return { ok: false, status: 400, error: "U této faktury není k dispozici PDF." };
  }

  const pdfBuf = await loadPlatformInvoicePdfBufferAdmin(data);
  const invNum = String(data.invoiceNumber || invoiceId).trim();
  const issueDate = String(data.issueDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const dueDate = String(data.dueDate || "").slice(0, 10) || null;
  const gross = Number(data.total);
  const net = Number(data.subtotal ?? data.amountNet ?? gross);
  const vatAmt = Number(data.vatAmount);
  const vatComputed =
    Number.isFinite(vatAmt) && vatAmt >= 0 ? vatAmt : Math.round((gross - net) * 100) / 100;
  const vatRate =
    Number.isFinite(net) && net > 0 && Number.isFinite(vatComputed) && vatComputed >= 0
      ? Math.round((vatComputed / net) * 100)
      : 21;

  const supplier = (data.supplier as Record<string, unknown> | undefined) ?? {};
  const entityName = String(supplier.companyName || "Provozovatel platformy").trim() || "Provozovatel platformy";

  const docRef = docsCol.doc();
  const documentId = docRef.id;
  const baseName = safeFileBase(invNum, "platform-faktura");
  const storagePath = `companies/${orgId}/documents/${documentId}/${baseName}.pdf`;
  const f = input.bucket.file(storagePath);
  await f.save(pdfBuf, {
    metadata: { contentType: "application/pdf", cacheControl: "private, max-age=120" },
  });
  try {
    await f.makePublic();
  } catch {
    /* ignore */
  }
  const encoded = encodeURIComponent(storagePath);
  const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${input.bucket.name}/o/${encoded}?alt=media`;

  await docRef.set({
    number: invNum,
    entityName,
    description: "Faktura za služby platformy",
    date: issueDate,
    type: "received",
    documentKind: "prijate",
    currency: "CZK",
    amountOriginal: gross,
    amountCZK: gross,
    exchangeRate: 1,
    amount: net,
    amountNet: net,
    castka: gross,
    castkaCZK: gross,
    amountNetCZK: net,
    amountGrossCZK: gross,
    vatAmountCZK: vatComputed,
    sDPH: true,
    vatRate,
    dphSazba: vatRate,
    vatAmount: vatComputed,
    amountGross: gross,
    vat: vatRate,
    organizationId: orgId,
    createdBy: input.actorUid,
    uploadedBy: input.actorUid,
    assignmentType: "company",
    jobId: null,
    zakazkaId: null,
    jobName: null,
    fileUrl,
    fileName: `${baseName}.pdf`,
    fileType: "application/pdf",
    mimeType: "application/pdf",
    storagePath,
    createdAt: FieldValue.serverTimestamp(),
    requiresPayment: true,
    dueDate,
    paymentStatus: "unpaid",
    paidAmount: 0,
    paidAt: null,
    paymentMethod: null,
    paymentNote: null,
    paid: false,
    isDeleted: false,
    source: "platformInvoice",
    sourceInvoiceId: invoiceId,
  });

  await invRef.set(
    {
      transferredToDocumentId: documentId,
      transferredToDocumentsAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, documentId, alreadyTransferred: false };
}
