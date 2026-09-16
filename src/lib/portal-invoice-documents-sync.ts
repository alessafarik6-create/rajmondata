/**
 * Propis vystavené portálové faktury do kolekce documents (vydaný doklad).
 */
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type Firestore,
  type UpdateData,
} from "firebase/firestore";

export type SyncPortalInvoiceDocumentInput = {
  firestore: Firestore;
  companyId: string;
  invoiceId: string;
  userId: string;
  uploadedByName: string;
  invoiceNumber: string;
  customerName: string;
  jobId: string | null;
  jobName: string | null;
  issueDate: string;
  dueDate: string;
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  /** Existující vazba z faktury — aktualizace místo nového záznamu. */
  linkedDocumentId?: string | null;
};

export async function syncPortalInvoiceToDocuments(
  input: SyncPortalInvoiceDocumentInput
): Promise<string> {
  const {
    firestore,
    companyId,
    invoiceId,
    userId,
    uploadedByName,
    invoiceNumber,
    customerName,
    jobId,
    jobName,
    issueDate,
    dueDate,
    amountNet,
    vatAmount,
    amountGross,
  } = input;

  const docsCol = collection(firestore, "companies", companyId, "documents");
  const linkedId = String(input.linkedDocumentId ?? "").trim();

  const payload: Record<string, unknown> = {
    number: invoiceNumber,
    entityName: customerName,
    description: `Vystavená faktura ${invoiceNumber}`,
    date: issueDate,
    type: "issued",
    documentKind: "vydane",
    documentType: "invoice",
    source: "portalInvoice",
    sourceInvoiceId: invoiceId,
    currency: "CZK",
    amountOriginal: amountGross,
    amountCZK: amountGross,
    exchangeRate: 1,
    amount: amountNet,
    amountNet,
    castka: amountGross,
    castkaCZK: amountGross,
    amountNetCZK: amountNet,
    amountGrossCZK: amountGross,
    vatAmountCZK: vatAmount,
    sDPH: true,
    vatAmount,
    amountGross,
    organizationId: companyId,
    updatedAt: serverTimestamp(),
    assignmentType: jobId ? "job_cost" : "general",
    jobId: jobId || null,
    zakazkaId: jobId || null,
    jobName: jobName || null,
    requiresPayment: true,
    dueDate: dueDate || null,
    paymentStatus: "unpaid",
    paidAmount: 0,
    paid: false,
    isDeleted: false,
  };

  if (linkedId) {
    await updateDoc(doc(docsCol, linkedId), payload as UpdateData<DocumentData>);
    return linkedId;
  }

  const dupQ = query(
    docsCol,
    where("sourceInvoiceId", "==", invoiceId),
    where("isDeleted", "==", false),
    limit(1)
  );
  const dupSnap = await getDocs(dupQ);
  if (!dupSnap.empty) {
    const existingId = dupSnap.docs[0].id;
    await updateDoc(doc(docsCol, existingId), payload as UpdateData<DocumentData>);
    return existingId;
  }

  const ref = await addDoc(docsCol, {
    ...payload,
    createdBy: userId,
    uploadedBy: userId,
    uploadedByName,
    createdAt: serverTimestamp(),
  } as DocumentData);
  return ref.id;
}

/** Při soft-delete faktury skryje i zrcadla v documents (sourceInvoiceId). */
export async function softDeleteLinkedDocumentsForInvoice(
  firestore: Firestore,
  companyId: string,
  invoiceId: string,
  userId: string
): Promise<number> {
  const id = String(invoiceId ?? "").trim();
  if (!id) return 0;
  const docsCol = collection(firestore, "companies", companyId, "documents");
  const q = query(docsCol, where("sourceInvoiceId", "==", id), limit(25));
  const snap = await getDocs(q);
  let updated = 0;
  for (const d of snap.docs) {
    const data = d.data() as { isDeleted?: unknown };
    if (data.isDeleted === true) continue;
    await updateDoc(d.ref, {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedBy: userId,
      updatedAt: serverTimestamp(),
    } as UpdateData<DocumentData>);
    updated += 1;
  }
  return updated;
}
