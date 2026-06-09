import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { handoverCompanyPdfMeta } from "@/lib/handover-protocol-company-pdf";
import { allocateNextDocumentNumber } from "@/lib/invoice-number-series";
import type { OrgBankAccountRow } from "@/lib/invoice-billing-meta";
import { buildCompanyRegisteredAddress } from "@/lib/inquiry-offer-footer";
import {
  buildPortalManualInvoiceHtml,
  buildRecipientAddressMultiline,
  invoiceRecipientFromCustomerDoc,
  PORTAL_MANUAL_INVOICE_TYPE,
  portalFormItemsForFirestore,
  recipientDisplayName,
  scrubFirestoreValue,
  type PortalManualFormItem,
} from "@/lib/portal-manual-invoice";
import { syncPortalInvoiceToDocuments } from "@/lib/portal-invoice-documents-sync";
import type { JobWorkBudgetItemDoc } from "@/lib/work-budget-types";

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

function defaultDueDateIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split("T")[0];
}

function workBudgetItemToInvoiceLine(item: JobWorkBudgetItemDoc): PortalManualFormItem {
  const title = trim(item.title);
  const desc = trim(item.description);
  const description = desc && desc !== title ? `${title} – ${desc}` : title || desc;
  return {
    id: item.id,
    description,
    quantity: item.quantity,
    unitPrice: item.unitPriceNet,
    priceType: "net",
    vatRate: item.vatRate,
    unit: item.unit || "ks",
    inventoryItemId: null,
    imageUrl: null,
  };
}

export function billableWorkBudgetItems(items: JobWorkBudgetItemDoc[]): JobWorkBudgetItemDoc[] {
  return items.filter((row) => row.done && !row.invoiced && row.amountGross > 0);
}

export async function createInvoiceFromWorkBudgetItems(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobDisplayName: string;
  customerId: string;
  customer: unknown;
  companyDoc: Record<string, unknown> | null | undefined;
  orgBankAccounts: OrgBankAccountRow[];
  items: JobWorkBudgetItemDoc[];
  userId: string;
  profileDisplayName?: string;
}): Promise<{ invoiceId: string; invoiceNumber: string; amountGross: number }> {
  const billable = billableWorkBudgetItems(params.items);
  if (billable.length === 0) {
    throw new Error("Žádné provedené nevyfakturované položky k fakturaci.");
  }

  const invoiceLines = billable.map(workBudgetItemToInvoiceLine);
  const recipient = invoiceRecipientFromCustomerDoc(params.customerId, params.customer);
  const companyMeta = handoverCompanyPdfMeta(params.companyDoc);
  const c = params.companyDoc ?? {};
  const supplierIco = trim(c.ico ?? c.companyIco) || null;
  const supplierDic = trim(c.dic ?? c.companyDic) || null;
  const legacyCompanyBank = trim(c.bankAccount ?? c.companyBankAccount) || null;

  const issueDate = new Date().toISOString().split("T")[0];
  const dueDate = defaultDueDateIso();
  const invoiceNumber = await allocateNextDocumentNumber(
    params.firestore,
    params.companyId,
    "FA"
  );

  const built = buildPortalManualInvoiceHtml({
    invoiceNumber,
    issueDate,
    dueDate,
    taxSupplyDate: issueDate,
    jobName: params.jobDisplayName,
    notes: "Faktura za provedené práce dle položkového rozpočtu zakázky.",
    recipient,
    supplierName: companyMeta.contractorCompanyName,
    supplierAddressLines: buildCompanyRegisteredAddress(c) ?? companyMeta.companyAddressText,
    supplierIco,
    supplierDic,
    logoUrl: companyMeta.logoUrl,
    items: invoiceLines,
    orgBankAccounts: params.orgBankAccounts,
    legacyCompanyBankLine: legacyCompanyBank,
  });

  const { html, amountNet, vatAmount, amountGross, variableSymbol, vatBreakdown } = built;
  const displayName = recipientDisplayName(recipient);
  const addrLines = buildRecipientAddressMultiline(recipient);
  const itemIds = billable.map((row) => row.id);

  const basePayload = scrubFirestoreValue({
    type: PORTAL_MANUAL_INVOICE_TYPE,
    organizationId: params.companyId,
    companyId: params.companyId,
    jobId: params.jobId,
    customerId: params.customerId.trim() || null,
    invoiceRecipient: scrubFirestoreValue({
      type: recipient.type,
      name: recipient.name,
      companyName: recipient.companyName ?? null,
      ico: recipient.ico ?? null,
      dic: recipient.dic ?? null,
      street: recipient.street ?? null,
      city: recipient.city ?? null,
      postalCode: recipient.postalCode ?? null,
      country: recipient.country ?? null,
      email: recipient.email ?? null,
      phone: recipient.phone ?? null,
      recipientNote: recipient.recipientNote ?? null,
      sourceCustomerId: recipient.sourceCustomerId ?? null,
    }),
    customerName: displayName,
    customerAddressLines: addrLines || displayName,
    customerPhone: recipient.phone ?? null,
    customerEmail: recipient.email ?? null,
    customerIco: recipient.ico ?? null,
    customerDic: recipient.dic ?? null,
    invoiceNumber,
    items: portalFormItemsForFirestore(invoiceLines),
    totalAmount: amountGross,
    amountNet,
    vatAmount,
    amountGross,
    vatBreakdown: vatBreakdown.map((b) => ({ rate: b.rate, base: b.base, vat: b.vat })),
    paymentStatus: "unpaid",
    requiresPayment: true,
    variableSymbol,
    pdfHtml: html,
    issueDate,
    dueDate,
    taxSupplyDate: issueDate,
    notes: "Faktura za provedené práce dle položkového rozpočtu zakázky.",
    status: "draft",
    issueStatus: "issued",
    isDeleted: false,
    workBudgetSource: true,
    workBudgetItemIds: itemIds,
    createdAt: serverTimestamp(),
    createdBy: params.userId,
    updatedAt: serverTimestamp(),
  }) as Record<string, unknown>;

  const invRef = await addDoc(
    collection(params.firestore, "companies", params.companyId, "invoices"),
    basePayload
  );

  const docId = await syncPortalInvoiceToDocuments({
    firestore: params.firestore,
    companyId: params.companyId,
    invoiceId: invRef.id,
    userId: params.userId,
    uploadedByName: params.profileDisplayName ?? "Uživatel",
    invoiceNumber,
    customerName: displayName,
    jobId: params.jobId,
    jobName: params.jobDisplayName !== "—" ? params.jobDisplayName : null,
    issueDate,
    dueDate,
    amountNet,
    vatAmount,
    amountGross,
  });

  await updateDoc(doc(params.firestore, "companies", params.companyId, "invoices", invRef.id), {
    linkedDocumentId: docId,
  });

  await addDoc(collection(params.firestore, "companies", params.companyId, "finance"), {
    amount: amountGross,
    type: "revenue",
    date: issueDate,
    description: `Faktura ${invoiceNumber}`,
    createdAt: serverTimestamp(),
  });

  const invoicedAt = new Date().toISOString();
  const batch = writeBatch(params.firestore);
  for (const row of billable) {
    batch.update(
      doc(
        params.firestore,
        "companies",
        params.companyId,
        "jobs",
        params.jobId,
        "workBudgetItems",
        row.id
      ),
      {
        invoiced: true,
        invoicedAt,
        linkedInvoiceId: invRef.id,
        updatedAt: serverTimestamp(),
      }
    );
  }
  await batch.commit();

  return { invoiceId: invRef.id, invoiceNumber, amountGross };
}
