/**
 * Fakturace organizací provozovatelem platformy (superadmin → platform_invoices).
 */
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  PLATFORM_INVOICES_COLLECTION,
  PLATFORM_SETTINGS_COLLECTION,
} from "@/lib/firestore-collections";
import { PLATFORM_BILLING_PROVIDER_DOC, PLATFORM_SETTINGS_DOC } from "@/lib/platform-config";
import type { InvoiceLineRow } from "@/lib/invoice-a4-html";
import { buildAdvanceInvoiceHtml } from "@/lib/invoice-a4-html";
import {
  buildInvoicePaymentQr,
  convertToIban,
  formatCustomerPartyLines,
  formatSupplierPartyLines,
  parsePaymentAccountString,
} from "@/lib/invoice-billing-meta";
import {
  computeEffectivePlatformInvoiceStatus,
  todayIsoDate,
} from "@/lib/platform-invoice-status";

export type PlatformInvoiceStoredStatus = "unpaid" | "paid" | "overdue" | "cancelled";

export { todayIsoDate, computeEffectivePlatformInvoiceStatus };

export function companyDocToBillingCustomer(data: Record<string, unknown>) {
  const name = String(data.companyName || data.name || "Organizace").trim() || "Organizace";
  const addrParts: string[] = [];
  const s = String(data.companyAddressStreetAndNumber || "").trim();
  const city = String(data.companyAddressCity || "").trim();
  const zip = String(data.companyAddressPostalCode || "").trim();
  const country = String(data.companyAddressCountry || "").trim();
  if (s) addrParts.push(s);
  const l2 = [zip, city].filter(Boolean).join(" ");
  if (l2) addrParts.push(l2);
  if (country) addrParts.push(country);
  let addr = addrParts.join("\n");
  if (!addr.trim()) addr = String(data.registeredOfficeAddress || data.address || "").trim();
  return {
    name,
    addressMultiline: addr || name,
    phone: String(data.phone || "").trim() || null,
    email: String(data.email || "").trim() || null,
    ico: String(data.ico || "").trim() || null,
    dic: String(data.dic || "").trim() || null,
  };
}

export function billingProviderToSupplierText(provider: Record<string, unknown>): string {
  return formatSupplierPartyLines({
    companyName: String(provider.companyName || "").trim() || "Provozovatel platformy",
    addressLines: String(provider.address || "").trim(),
    ico: String(provider.ico || "").trim() || null,
    dic: String(provider.dic || "").trim() || null,
  });
}

export function billingProviderBankBoxText(provider: Record<string, unknown>): string {
  const lines: string[] = [];
  const acc = String(provider.accountNumber || "").trim();
  if (acc) lines.push(`Účet: ${acc}`);
  const iban = String(provider.iban || "").trim();
  if (iban) lines.push(`IBAN: ${iban}`);
  const swift = String(provider.swift || "").trim();
  if (swift) lines.push(`SWIFT / BIC: ${swift}`);
  return lines.join("\n");
}

export function variableSymbolFromInvoiceNumber(num: string): string {
  const d = num.replace(/\D/g, "");
  if (d.length >= 4) return d.slice(-10);
  return num.replace(/\s/g, "").slice(0, 10).replace(/\D/g, "") || "0";
}

export function buildPlatformFeeInvoiceHtml(input: {
  billingProvider: Record<string, unknown>;
  customer: ReturnType<typeof companyDocToBillingCustomer>;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  taxSupplyDate?: string | null;
  periodFrom: string;
  periodTo: string;
  items: InvoiceLineRow[];
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  primaryVatLabel: string;
  note: string | null;
  variableSymbol: string;
}): string {
  const p = input.billingProvider;
  const supplierText = billingProviderToSupplierText(p);
  const cust = input.customer;
  const customerText = formatCustomerPartyLines(
    cust.name,
    cust.addressMultiline,
    cust.phone,
    cust.email,
    cust.ico,
    cust.dic
  );
  const bankText = billingProviderBankBoxText(p);
  const accRaw = String(p.accountNumber || "").trim();
  const { accountNumber, bankCode, iban: parsedIban } = parsePaymentAccountString(accRaw);
  const ibanResolved =
    String(p.iban || "").trim() ||
    (parsedIban ? parsedIban : convertToIban(accountNumber, bankCode) || "") ||
    null;
  const qr = buildInvoicePaymentQr({
    iban: ibanResolved,
    bankAccountNumber: accountNumber,
    bankCode,
    amountGross: input.amountGross,
    variableSymbol: input.variableSymbol,
    message: `FA ${input.invoiceNumber}`.slice(0, 60),
  });
  return buildAdvanceInvoiceHtml({
    logoUrl: (p.logoUrl as string) || null,
    title: "Faktura — služby platformy",
    supplierName: String(p.companyName || "Provozovatel platformy").trim(),
    supplierAddressText: supplierText,
    customerName: cust.name,
    customerAddressText: customerText,
    invoiceNumber: input.invoiceNumber,
    issueDate: input.issueDate,
    taxSupplyDate: input.taxSupplyDate ?? input.issueDate,
    dueDate: input.dueDate,
    jobName: `Účtované období ${input.periodFrom} – ${input.periodTo}`,
    contractNumber: null,
    variableSymbol: input.variableSymbol,
    bankAccountText: bankText || null,
    paymentDueDate: input.dueDate,
    paymentQrUrl: qr?.warning ? null : qr?.qrUrl || null,
    paymentQrWarning: qr?.warning || null,
    items: input.items,
    amountNet: input.amountNet,
    vatAmount: input.vatAmount,
    amountGross: input.amountGross,
    primaryVatRateLabel: input.primaryVatLabel,
    note:
      input.note?.trim() ||
      "Faktura za používání softwarové platformy dle platné smlouvy / obchodních podmínek.",
    supplierStampUrl: (p.stampUrl as string) || null,
    supplierFooterText: String(p.invoiceFooterText || "").trim() || null,
  });
}

export async function allocatePlatformInvoiceSequence(db: Firestore): Promise<number> {
  return db.runTransaction(async (tx) => {
    const ref = db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_SETTINGS_DOC);
    const snap = await tx.get(ref);
    const cur = Number((snap.data() as Record<string, unknown> | undefined)?.platformInvoiceSeq ?? 0);
    const next = Number.isFinite(cur) && cur >= 0 ? cur + 1 : 1;
    tx.set(
      ref,
      { platformInvoiceSeq: next, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return next;
  });
}

export function formatPlatformInvoiceNumber(seq: number, year: number): string {
  return `PF-${year}-${String(seq).padStart(5, "0")}`;
}

export async function loadBillingProviderOrThrow(db: Firestore): Promise<Record<string, unknown>> {
  const ref = db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_BILLING_PROVIDER_DOC);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Chybí nastavení provozovatele (billingProvider).");
  const d = snap.data() as Record<string, unknown>;
  if (!String(d.companyName || "").trim()) {
    throw new Error("Doplňte název firmy provozovatele v superadministraci (Fakturační údaje).");
  }
  return d;
}

export async function loadCompanyDocOrThrow(
  db: Firestore,
  organizationId: string
): Promise<Record<string, unknown>> {
  const snap = await db.collection(COMPANIES_COLLECTION).doc(organizationId).get();
  if (!snap.exists) throw new Error("Organizace (companies) neexistuje.");
  return snap.data() as Record<string, unknown>;
}

export function snapshotSupplierFromProvider(provider: Record<string, unknown>): Record<string, unknown> {
  return {
    companyName: String(provider.companyName || "").trim(),
    address: String(provider.address || "").trim(),
    ico: String(provider.ico || "").trim(),
    dic: String(provider.dic || "").trim(),
    email: String(provider.email || "").trim(),
    phone: String(provider.phone || "").trim(),
    accountNumber: String(provider.accountNumber || "").trim(),
    iban: String(provider.iban || "").trim(),
    swift: String(provider.swift || "").trim(),
    logoUrl: provider.logoUrl ?? null,
    stampUrl: provider.stampUrl ?? null,
    invoiceFooterText: String(provider.invoiceFooterText || "").trim(),
  };
}

export function snapshotCustomerFromCompany(
  companyId: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const c = companyDocToBillingCustomer(data);
  return {
    organizationId: companyId,
    name: c.name,
    addressMultiline: c.addressMultiline,
    phone: c.phone,
    email: c.email,
    ico: c.ico,
    dic: c.dic,
  };
}

export type PlatformInvoiceLineInput = {
  kind?: string;
  description: string;
  quantity: number;
  unit?: string;
  unitPriceNet: number;
  vatRate: number;
};

export function buildLineRowsFromInput(lines: PlatformInvoiceLineInput[]): InvoiceLineRow[] {
  const out: InvoiceLineRow[] = [];
  for (const ln of lines) {
    const qty = Number(ln.quantity);
    const unitPrice = Number(ln.unitPriceNet);
    const vatRate = Number(ln.vatRate);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Každá položka musí mít kladné množství.");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Neplatná cena bez DPH u položky.");
    if (!Number.isFinite(vatRate) || vatRate < 0) throw new Error("Neplatná sazba DPH u položky.");
    const lineNet = Math.round(qty * unitPrice * 100) / 100;
    const lineVat = Math.round(lineNet * (vatRate / 100) * 100) / 100;
    const lineGross = Math.round((lineNet + lineVat) * 100) / 100;
    out.push({
      description: String(ln.description || "").trim() || "Položka",
      quantity: qty,
      unit: String(ln.unit || "ks").trim() || "ks",
      unitPriceNet: Math.round(unitPrice * 100) / 100,
      vatRate,
      lineNet,
      lineVat,
      lineGross,
    });
  }
  return out;
}

export function sumInvoiceLines(rows: InvoiceLineRow[]): {
  amountNet: number;
  vatAmount: number;
  amountGross: number;
} {
  let amountNet = 0;
  let vatAmount = 0;
  let amountGross = 0;
  for (const r of rows) {
    amountNet += r.lineNet;
    vatAmount += r.lineVat;
    amountGross += r.lineGross;
  }
  return {
    amountNet: Math.round(amountNet * 100) / 100,
    vatAmount: Math.round(vatAmount * 100) / 100,
    amountGross: Math.round(amountGross * 100) / 100,
  };
}

export async function listPlatformInvoicesForOrganization(
  db: Firestore,
  organizationId: string,
  max = 100
): Promise<Array<Record<string, unknown> & { id: string; displayStatus: string }>> {
  const q = await db
    .collection(PLATFORM_INVOICES_COLLECTION)
    .where("organizationId", "==", organizationId)
    .orderBy("createdAt", "desc")
    .limit(max)
    .get();
  return q.docs.map((d) => {
    const data = (d.data() ?? {}) as Record<string, unknown>;
    const row: Record<string, unknown> & { id: string } = { ...data, id: d.id };
    const st = String(row.status || "unpaid");
    const due = String(row.dueDate || "");
    const displayStatus = computeEffectivePlatformInvoiceStatus(st, due);
    return { ...row, displayStatus };
  });
}
