/**
 * Synchronizace stavu úhrady mezi dokladem (documents) a vystavenou fakturou (invoices).
 */
import {
  doc,
  serverTimestamp,
  updateDoc,
  type Firestore,
  type UpdateData,
  type DocumentData,
} from "firebase/firestore";
import {
  documentGrossForPayment,
  type CompanyDocumentPaymentRow,
} from "@/lib/company-document-payment";
import { portalInvoiceGross } from "@/lib/company-document-payment";

export async function syncLinkedInvoicePaymentFromDocument(params: {
  firestore: Firestore;
  companyId: string;
  document: CompanyDocumentPaymentRow;
  mode: "paid" | "unpaid" | "partial";
  paidAmount?: number | null;
  paidAt?: string | null;
}): Promise<void> {
  const invoiceId = String(
    params.document.sourceInvoiceId ?? params.document.invoiceId ?? ""
  ).trim();
  if (!invoiceId) return;

  const invRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "invoices",
    invoiceId
  );

  if (params.mode === "unpaid") {
    await updateDoc(invRef, {
      status: "sent",
      paymentStatus: "unpaid",
      paidAmount: null,
      paidGrossReceived: null,
      paidAt: null,
      updatedAt: serverTimestamp(),
    } as UpdateData<DocumentData>);
    return;
  }

  const docGross = documentGrossForPayment(params.document);
  const gross = docGross > 0 ? docGross : 0;
  const paid =
    params.mode === "paid"
      ? gross
      : Math.min(
          gross,
          Math.max(0, Number(params.paidAmount ?? 0))
        );

  const fullyPaid = gross > 0 && paid >= gross - 0.009;
  await updateDoc(invRef, {
    status: fullyPaid ? "paid" : "partially_paid",
    paymentStatus: fullyPaid ? "paid" : "partial",
    paidAmount: paid > 0 ? paid : null,
    paidGrossReceived: paid > 0 ? paid : null,
    paidAt: params.paidAt ?? new Date().toISOString().split("T")[0],
    updatedAt: serverTimestamp(),
  } as UpdateData<DocumentData>);
}

export async function syncLinkedDocumentPaymentFromInvoice(params: {
  firestore: Firestore;
  companyId: string;
  documentId: string;
  invoice: Record<string, unknown>;
}): Promise<void> {
  const gross = portalInvoiceGross(params.invoice);
  const paid = Number(
    params.invoice.paidAmount ?? params.invoice.paidGrossReceived ?? 0
  );
  const status = String(params.invoice.status ?? "").trim().toLowerCase();
  const ps = String(params.invoice.paymentStatus ?? "").trim().toLowerCase();
  const fullyPaid =
    status === "paid" ||
    ps === "paid" ||
    (gross > 0 && paid >= gross - 0.009);

  const docRef = doc(
    params.firestore,
    "companies",
    params.companyId,
    "documents",
    params.documentId
  );

  if (fullyPaid) {
    await updateDoc(docRef, {
      paymentStatus: "paid",
      paidAmount: gross > 0 ? gross : paid,
      paid: true,
      paidAt:
        String(params.invoice.paidAt ?? "").trim() ||
        new Date().toISOString().split("T")[0],
      updatedAt: serverTimestamp(),
    } as UpdateData<DocumentData>);
    return;
  }

  if (paid > 0) {
    await updateDoc(docRef, {
      paymentStatus: "partial",
      paidAmount: paid,
      paid: false,
      updatedAt: serverTimestamp(),
    } as UpdateData<DocumentData>);
    return;
  }

  await updateDoc(docRef, {
    paymentStatus: "unpaid",
    paidAmount: null,
    paid: false,
    paidAt: null,
    updatedAt: serverTimestamp(),
  } as UpdateData<DocumentData>);
}
