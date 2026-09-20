/** Jednotný popisek zakázky v e-mailovém modulu (stejná logika jako contact-resolve). */
export function formatJobPickerLabel(row: {
  orderNumber?: string | null;
  title?: string | null;
  customerName?: string | null;
  id?: string;
}): string {
  const orderNumber = String(row.orderNumber ?? "").trim();
  const title = String(row.title ?? "").trim();
  const customerName = String(row.customerName ?? "").trim();
  const parts = [orderNumber, customerName, title].filter(Boolean);
  if (parts.length) return parts.join(" – ");
  return String(row.id ?? "").trim() || "—";
}

export type EmailJobPickerRow = {
  id: string;
  orderNumber: string;
  title: string;
  customerName: string;
  address: string;
  label: string;
};

export function jobSearchHaystackFromJobData(id: string, data: Record<string, unknown>): string {
  const orderNumber = String(data.orderNumber ?? data.jobNumber ?? "").trim();
  const title = String(data.title ?? data.name ?? "").trim();
  const customerName = String(data.customerName ?? data.clientName ?? "").trim();
  const address = String(data.address ?? data.siteAddress ?? "").trim();
  const customerPhone = String(data.customerPhone ?? data.phone ?? "").trim();
  const customerEmail = String(data.customerEmail ?? data.email ?? "").trim();
  return `${orderNumber} ${title} ${customerName} ${address} ${customerPhone} ${customerEmail} ${id}`.toLowerCase();
}

export function mapFirestoreJobToPickerRow(
  id: string,
  data: Record<string, unknown>
): EmailJobPickerRow & { updatedAtMs: number } {
  const orderNumber = String(data.orderNumber ?? data.jobNumber ?? "").trim();
  const title = String(data.title ?? data.name ?? "").trim();
  const customerName = String(data.customerName ?? data.clientName ?? "").trim();
  const address = String(data.address ?? data.siteAddress ?? "").trim();
  const updatedAt = data.updatedAt as { toMillis?: () => number } | undefined;
  const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
  const updatedAtMs =
    typeof updatedAt?.toMillis === "function"
      ? updatedAt.toMillis()
      : typeof createdAt?.toMillis === "function"
        ? createdAt.toMillis()
        : 0;

  return {
    id,
    orderNumber,
    title,
    customerName,
    address,
    label: formatJobPickerLabel({ orderNumber, title, customerName, id }),
    updatedAtMs,
  };
}
