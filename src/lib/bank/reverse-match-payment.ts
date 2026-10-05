import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  getPortalInvoicePaymentState,
  portalInvoiceTotalAmountGross,
} from "@/lib/invoice-payment-state";
import { roundMoney2 } from "@/lib/vat-calculations";

export async function reverseInvoicePaymentForBankMatch(
  db: Firestore,
  organizationId: string,
  invoiceId: string,
  paymentId: string,
  todayIso: string
): Promise<void> {
  const invRef = db.collection("companies").doc(organizationId).collection("invoices").doc(invoiceId);
  const payRef = invRef.collection("payments").doc(paymentId);
  const paySnap = await payRef.get();
  if (!paySnap.exists) return;

  const payAmount = roundMoney2(Number(paySnap.data()?.amount ?? 0));
  if (payAmount <= 0) {
    await payRef.delete();
    return;
  }

  const invSnap = await invRef.get();
  if (!invSnap.exists) {
    await payRef.delete();
    return;
  }
  const invData = invSnap.data() as Record<string, unknown>;
  const before = getPortalInvoicePaymentState({ ...invData, id: invoiceId }, todayIso);
  const newPaid = Math.max(0, roundMoney2(before.paidAmount - payAmount));
  const total = before.totalAmount;
  const remaining = Math.max(0, roundMoney2(total - newPaid));
  const fullyPaid = total > 0 && remaining <= 0.009;
  const nextStatus = fullyPaid ? "paid" : newPaid > 0 ? "partially_paid" : "issued";
  const nextPaymentStatus = fullyPaid ? "paid" : newPaid > 0 ? "partial" : "unpaid";

  await payRef.delete();
  await invRef.update({
    paidAmount: newPaid,
    paidGrossReceived: newPaid,
    paymentStatus: nextPaymentStatus,
    status: nextStatus,
    paidAt: fullyPaid ? invData.paidAt ?? todayIso : newPaid > 0 ? invData.paidAt ?? null : null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const docsSnap = await db
    .collection("companies")
    .doc(organizationId)
    .collection("documents")
    .where("sourceInvoiceId", "==", invoiceId)
    .limit(12)
    .get();
  const gross = portalInvoiceTotalAmountGross({ ...invData, paidAmount: newPaid });
  for (const d of docsSnap.docs) {
    if (d.data().isDeleted === true) continue;
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (fullyPaid) {
      patch.paymentStatus = "paid";
      patch.paidAmount = gross > 0 ? gross : newPaid;
      patch.paid = true;
    } else if (newPaid > 0) {
      patch.paymentStatus = "partial";
      patch.paidAmount = newPaid;
      patch.paid = false;
    } else {
      patch.paymentStatus = "unpaid";
      patch.paidAmount = null;
      patch.paid = false;
      patch.paidAt = null;
    }
    await d.ref.update(patch);
  }
}

export async function reverseDocumentPaymentForBankMatch(
  db: Firestore,
  organizationId: string,
  documentId: string,
  amount: number
): Promise<void> {
  const docRef = db.collection("companies").doc(organizationId).collection("documents").doc(documentId);
  const snap = await docRef.get();
  if (!snap.exists) return;
  const data = snap.data() as Record<string, unknown>;
  const paid = roundMoney2(Number(data.paidAmount ?? 0));
  const newPaid = Math.max(0, roundMoney2(paid - amount));
  const total = roundMoney2(Number(data.totalAmount ?? data.amount ?? 0));
  const remaining = Math.max(0, roundMoney2(total - newPaid));
  const fullyPaid = total > 0 && remaining <= 0.009;

  await docRef.update({
    paidAmount: newPaid > 0 ? newPaid : null,
    paymentStatus: fullyPaid ? "paid" : newPaid > 0 ? "partial" : "unpaid",
    paid: fullyPaid,
    paidAt: fullyPaid ? data.paidAt ?? null : newPaid > 0 ? data.paidAt ?? null : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
