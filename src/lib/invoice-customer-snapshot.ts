/** Snapshot odběratele na faktuře / daňovém dokladu — nezávislý na kartě zákazníka. */

export type InvoiceRecipientType = "person" | "company";

export type InvoiceCustomerSnapshot = {
  customerId?: string | null;
  type: InvoiceRecipientType;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  ico?: string | null;
  dic?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
};

export function invoiceRecipientDisplayName(snap: InvoiceCustomerSnapshot): string {
  if (snap.type === "company") {
    const cn = String(snap.companyName ?? "").trim();
    if (cn) return cn;
  }
  const full = `${String(snap.firstName ?? "").trim()} ${String(snap.lastName ?? "").trim()}`.trim();
  return full || String(snap.companyName ?? "").trim() || "Odběratel";
}

export function invoiceRecipientAddressLines(snap: InvoiceCustomerSnapshot): string {
  const parts = [
    [snap.street].filter(Boolean).join(" "),
    [snap.postalCode, snap.city].filter(Boolean).join(" "),
    snap.country ? String(snap.country) : "",
  ].filter((l) => String(l).trim());
  return parts.join("\n").trim();
}

export function snapshotFromCustomerDoc(
  customerId: string,
  doc: Record<string, unknown>
): InvoiceCustomerSnapshot {
  const companyName = String(doc.companyName ?? "").trim();
  const firstName = String(doc.firstName ?? "").trim();
  const lastName = String(doc.lastName ?? "").trim();
  const type: InvoiceRecipientType =
    companyName && !firstName && !lastName
      ? "company"
      : companyName
        ? "company"
        : "person";
  return {
    customerId,
    type,
    companyName: companyName || null,
    firstName: firstName || null,
    lastName: lastName || null,
    ico: String(doc.ico ?? doc.ic ?? "").trim() || null,
    dic: String(doc.dic ?? "").trim() || null,
    street: String(doc.street ?? doc.address ?? "").trim() || null,
    city: String(doc.city ?? "").trim() || null,
    postalCode: String(doc.postalCode ?? doc.zip ?? "").trim() || null,
    country: String(doc.country ?? "CZ").trim() || null,
    email: String(doc.email ?? "").trim() || null,
    phone: String(doc.phone ?? "").trim() || null,
  };
}

export function snapshotFromInvoiceRecord(
  inv: Record<string, unknown>
): InvoiceCustomerSnapshot {
  const raw = inv.customerSnapshot as InvoiceCustomerSnapshot | undefined;
  if (raw && typeof raw === "object" && raw.type) {
    return { ...raw };
  }
  const companyName = String(inv.customerName ?? "").trim();
  const lines = String(inv.customerAddressLines ?? inv.customerAddress ?? "").trim();
  const street = lines.split("\n")[0]?.trim() || null;
  return {
    customerId: String(inv.customerId ?? "").trim() || null,
    type: String(inv.customerIco ?? inv.customerDic ?? "").trim() ? "company" : "person",
    companyName: companyName || null,
    firstName: null,
    lastName: null,
    ico: String(inv.customerIco ?? "").trim() || null,
    dic: String(inv.customerDic ?? "").trim() || null,
    street,
    city: null,
    postalCode: null,
    country: "CZ",
    email: String(inv.customerEmail ?? "").trim() || null,
    phone: String(inv.customerPhone ?? "").trim() || null,
  };
}
