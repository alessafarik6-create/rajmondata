/**
 * Ruční faktura z portálu (ne ze zálohové šablony zakázky) — odběratel: zákazník / IČ+ARES / ručně.
 */

import type { InvoiceLineRow } from "@/lib/invoice-a4-html";
import { buildAdvanceInvoiceHtml } from "@/lib/invoice-a4-html";
import {
  buildInvoicePaymentQr,
  formatBankBlockPlainLines,
  formatCustomerPartyLines,
  formatSupplierPartyLines,
  resolveInvoiceVariableSymbol,
  resolvePaymentAccount,
  type OrgBankAccountRow,
} from "@/lib/invoice-billing-meta";
import { buildCustomerAddressMultiline } from "@/lib/customer-address-display";
import type { CompanyLookupResult } from "@/lib/company-lookup-api";
import { validateCzechIcoInput } from "@/lib/company-lookup-api";

export const PORTAL_MANUAL_INVOICE_TYPE = "portal_manual" as const;

export type PortalInvoiceRecipientType = "job_customer" | "company_by_ic" | "manual";

/** Snapshot odběratele uložený na faktuře (bez undefined — vhodné pro Firestore). */
export type InvoiceRecipientSnapshot = {
  type: PortalInvoiceRecipientType;
  /** Zobrazovaný název / jméno */
  name: string;
  companyName?: string | null;
  ico?: string | null;
  dic?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  recipientNote?: string | null;
  sourceCustomerId?: string | null;
};

export type PortalManualFormItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

const DEFAULT_VAT = 21;

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

export function scrubFirestoreValue<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      const nested = scrubFirestoreValue(v as Record<string, unknown>);
      if (Object.keys(nested).length > 0) out[k] = nested;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function recipientDisplayName(r: InvoiceRecipientSnapshot): string {
  const c = trim(r.companyName);
  const n = trim(r.name);
  return c || n || "Odběratel";
}

export function buildRecipientAddressMultiline(r: InvoiceRecipientSnapshot): string {
  const street = trim(r.street);
  const city = trim(r.city);
  const zip = trim(r.postalCode);
  const country = trim(r.country);
  const line2 = [zip, city].filter(Boolean).join(" ");
  return [street, line2, country].filter(Boolean).join("\n");
}

/** Zákazník ze seznamu customers — pro typ job_customer. */
export function invoiceRecipientFromCustomerDoc(
  customerId: string,
  customer: unknown
): InvoiceRecipientSnapshot {
  if (!customer || typeof customer !== "object") {
    return {
      type: "job_customer",
      name: "Odběratel",
      sourceCustomerId: customerId,
    };
  }
  const o = customer as Record<string, unknown>;
  const companyName = trim(o.companyName);
  const first = trim(o.firstName);
  const last = trim(o.lastName);
  const person = [first, last].filter(Boolean).join(" ");
  const name = companyName || person || "Odběratel";
  return {
    type: "job_customer",
    name,
    companyName: companyName || null,
    street: trim(o.companyAddressStreetAndNumber) || null,
    city: trim(o.companyAddressCity) || null,
    postalCode: trim(o.companyAddressPostalCode) || null,
    country: trim(o.companyAddressCountry) || "Česká republika",
    email: trim(o.email) || null,
    phone: trim(o.phone) || null,
    ico: trim(o.ico) || null,
    dic: trim(o.dic) || null,
    sourceCustomerId: customerId,
  };
}

export function mergeAresIntoRecipient(
  prev: InvoiceRecipientSnapshot,
  res: CompanyLookupResult
): InvoiceRecipientSnapshot {
  return {
    ...prev,
    type: "company_by_ic",
    name: res.companyName,
    companyName: res.companyName,
    ico: res.ico,
    dic: res.dic != null && String(res.dic).trim() ? String(res.dic).trim() : prev.dic ?? null,
    street: res.address.street || prev.street || null,
    city: res.address.city || prev.city || null,
    postalCode: res.address.postalCode || prev.postalCode || null,
    country: res.address.country?.trim() || prev.country || "Česká republika",
  };
}

export function parseInvoiceRecipientFromInvoiceDoc(
  inv: Record<string, unknown> | null | undefined
): InvoiceRecipientSnapshot | null {
  if (!inv) return null;
  const raw = inv.invoiceRecipient;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const t = o.type;
  if (t !== "job_customer" && t !== "company_by_ic" && t !== "manual") return null;
  return {
    type: t,
    name: trim(o.name) || "Odběratel",
    companyName: trim(o.companyName) || null,
    ico: trim(o.ico) || null,
    dic: trim(o.dic) || null,
    street: trim(o.street) || null,
    city: trim(o.city) || null,
    postalCode: trim(o.postalCode) || null,
    country: trim(o.country) || null,
    email: trim(o.email) || null,
    phone: trim(o.phone) || null,
    recipientNote: trim(o.recipientNote) || null,
    sourceCustomerId: trim(o.sourceCustomerId) || null,
  };
}

/**
 * Odběratel pro PDF / party lines — priorita snapshot, jinak legacy customerId + customer doc.
 */
export function resolvePortalInvoiceRecipientDisplay(params: {
  invoice: Record<string, unknown>;
  customerDoc?: unknown | null;
}): {
  customerName: string;
  customerPartyText: string;
  customerIco: string | null;
  customerDic: string | null;
} {
  const snap = parseInvoiceRecipientFromInvoiceDoc(params.invoice);
  if (snap) {
    const name = recipientDisplayName(snap);
    const addr = buildRecipientAddressMultiline(snap);
    const party = formatCustomerPartyLines(
      name,
      addr || name,
      snap.phone,
      snap.email,
      snap.ico,
      snap.dic
    );
    return {
      customerName: name,
      customerPartyText: party,
      customerIco: snap.ico?.trim() || null,
      customerDic: snap.dic?.trim() || null,
    };
  }

  const custId = trim(params.invoice.customerId);
  const c = params.customerDoc;
  const fallbackName =
    trim(params.invoice.customerName) ||
    (c && typeof c === "object"
      ? trim((c as Record<string, unknown>).companyName) ||
        [trim((c as Record<string, unknown>).firstName), trim((c as Record<string, unknown>).lastName)]
          .filter(Boolean)
          .join(" ")
      : "") ||
    "Odběratel";
  const addrFromDoc = c ? buildCustomerAddressMultiline(c) : "";
  const addr =
    trim(params.invoice.customerAddressLines) ||
    addrFromDoc ||
    fallbackName;
  const phone =
    trim(params.invoice.customerPhone) ||
    (c && typeof c === "object" ? trim((c as Record<string, unknown>).phone) : "") ||
    null;
  const email =
    trim(params.invoice.customerEmail) ||
    (c && typeof c === "object" ? trim((c as Record<string, unknown>).email) : "") ||
    null;
  const ico =
    trim(params.invoice.customerIco) ||
    (c && typeof c === "object" ? trim((c as Record<string, unknown>).ico) : "") ||
    null;
  const dic =
    trim(params.invoice.customerDic) ||
    (c && typeof c === "object" ? trim((c as Record<string, unknown>).dic) : "") ||
    null;
  const party = formatCustomerPartyLines(fallbackName, addr, phone, email, ico, dic);
  return {
    customerName: fallbackName,
    customerPartyText: party,
    customerIco: ico || null,
    customerDic: dic || null,
  };
}

export function validateInvoiceRecipientSnapshot(
  r: InvoiceRecipientSnapshot,
  jobCustomerId: string
): string | null {
  if (r.type === "job_customer") {
    if (!trim(jobCustomerId)) return "Vyberte zákazníka ze seznamu.";
    return null;
  }
  if (r.type === "company_by_ic") {
    const ico = trim(r.ico);
    const icoErr = validateCzechIcoInput(ico);
    if (icoErr) return icoErr;
    if (!trim(r.name)) return "Doplňte název firmy (např. z ARES nebo ručně).";
    return null;
  }
  if (r.type === "manual") {
    if (!trim(r.name)) return "Vyplňte jméno nebo název odběratele.";
    if (!trim(r.street)) return "Vyplňte ulici a číslo popisné.";
    if (!trim(r.city)) return "Vyplňte město.";
    if (!trim(r.postalCode)) return "Vyplňte PSČ.";
    return null;
  }
  return "Neplatný typ odběratele.";
}

/** Položky z formuláře: unitPrice = cena za jednotku včetně DPH (jako dosud na /invoices/new). */
export function portalGrossItemsToLineRows(
  items: PortalManualFormItem[],
  vatRate: number = DEFAULT_VAT
): { rows: InvoiceLineRow[]; amountNet: number; vatAmount: number; amountGross: number } {
  const factor = 1 + vatRate / 100;
  let amountNet = 0;
  let amountGross = 0;
  const rows: InvoiceLineRow[] = [];
  for (const it of items) {
    const qty = Math.max(0, Number(it.quantity) || 0);
    const unitGross = Math.max(0, Number(it.unitPrice) || 0);
    const desc = trim(it.description);
    if (!desc || qty <= 0 || unitGross <= 0) continue;
    const lineGross = qty * unitGross;
    const lineNet = lineGross / factor;
    const lineVat = lineGross - lineNet;
    const unitNet = lineNet / qty;
    amountNet += lineNet;
    amountGross += lineGross;
    rows.push({
      description: desc,
      quantity: qty,
      unit: "ks",
      unitPriceNet: unitNet,
      vatRate,
      lineNet,
      lineVat,
      lineGross,
    });
  }
  const vatAmount = amountGross - amountNet;
  return { rows, amountNet, vatAmount, amountGross };
}

export function paymentMessagePortalManual(invoiceNumber: string, jobLabel: string): string {
  const inv = String(invoiceNumber || "").trim();
  const j = String(jobLabel || "").trim();
  const base = inv || "faktura";
  if (j && j !== "—") return `${base} · ${j}`.slice(0, 60);
  return base.slice(0, 60);
}

export type BuildPortalManualInvoiceHtmlParams = {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  taxSupplyDate?: string | null;
  jobName: string;
  notes?: string | null;
  recipient: InvoiceRecipientSnapshot;
  supplierName: string;
  supplierAddressLines: string;
  supplierIco?: string | null;
  supplierDic?: string | null;
  logoUrl?: string | null;
  items: PortalManualFormItem[];
  orgBankAccounts: OrgBankAccountRow[];
  overrideBankAccountId?: string | null;
  legacyCompanyBankLine?: string | null;
};

export function buildPortalManualInvoiceHtml(
  params: BuildPortalManualInvoiceHtmlParams
): {
  html: string;
  rows: InvoiceLineRow[];
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  variableSymbol: string;
} {
  const { rows, amountNet, vatAmount, amountGross } = portalGrossItemsToLineRows(
    params.items,
    DEFAULT_VAT
  );
  if (rows.length === 0 || amountGross <= 0) {
    throw new Error("Přidejte alespoň jednu položku s kladnou částkou s DPH.");
  }
  const name = recipientDisplayName(params.recipient);
  const addrBlock = buildRecipientAddressMultiline(params.recipient);
  const customerParty = formatCustomerPartyLines(
    name,
    addrBlock || name,
    params.recipient.phone,
    params.recipient.email,
    params.recipient.ico,
    params.recipient.dic
  );
  const supplierParty = formatSupplierPartyLines({
    companyName: params.supplierName,
    addressLines: params.supplierAddressLines || "",
    ico: params.supplierIco,
    dic: params.supplierDic,
  });
  const vs = resolveInvoiceVariableSymbol({
    contractNumber: null,
    invoiceNumber: params.invoiceNumber,
  });
  const bankSnap = resolvePaymentAccount({
    bankAccounts: params.orgBankAccounts ?? [],
    overrideBankAccountId: params.overrideBankAccountId ?? null,
    contract: null,
    job: null,
    legacyCompanyBankLine: params.legacyCompanyBankLine ?? null,
  });
  const bankText = formatBankBlockPlainLines(bankSnap);
  const qr = buildInvoicePaymentQr({
    iban: bankSnap.iban,
    bankAccountNumber: bankSnap.bankAccountNumber,
    bankCode: bankSnap.bankCode,
    amountGross,
    variableSymbol: vs,
    message: paymentMessagePortalManual(params.invoiceNumber, params.jobName),
  });
  const taxSupply =
    (params.taxSupplyDate && String(params.taxSupplyDate).trim()) || params.issueDate;
  const allSameVat = rows.every((r) => r.vatRate === rows[0].vatRate);
  const note =
    trim(params.notes) ||
    "Faktura dle zákona č. 235/2004 Sb., o dani z přidané hodnoty, ve znění pozdějších předpisů.";
  const html = buildAdvanceInvoiceHtml({
    logoUrl: params.logoUrl ?? null,
    title: "Faktura – daňový doklad",
    supplierName: params.supplierName,
    supplierAddressText: supplierParty,
    customerName: name,
    customerAddressText: customerParty,
    invoiceNumber: params.invoiceNumber,
    issueDate: params.issueDate,
    taxSupplyDate: taxSupply,
    dueDate: params.dueDate,
    jobName: params.jobName || "—",
    contractNumber: null,
    variableSymbol: vs,
    bankAccountText: bankText,
    paymentDueDate: params.dueDate,
    paymentQrUrl: qr?.warning ? null : qr?.qrUrl ?? null,
    paymentQrWarning: qr?.warning ?? null,
    items: rows,
    amountNet,
    vatAmount,
    amountGross,
    primaryVatRateLabel: allSameVat ? `${rows[0].vatRate}` : "smíšené",
    note,
  });
  return { html, rows, amountNet, vatAmount, amountGross, variableSymbol: vs };
}

/** Firestore položky (bez výpočtových polí jako lineNet) — zjednodušeně jako u nové stránky. */
export function portalFormItemsForFirestore(items: PortalManualFormItem[]): Record<string, unknown>[] {
  return items.map((it) =>
    scrubFirestoreValue({
      id: it.id,
      description: trim(it.description),
      quantity: Number(it.quantity) || 0,
      unitPrice: Number(it.unitPrice) || 0,
    })
  );
}
