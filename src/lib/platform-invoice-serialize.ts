/** Normalizace Firestore Timestamp z Admin SDK pro JSON odpovědi API. */
export function serializePlatformInvoiceRowForApi(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  const keys = [
    "createdAt",
    "updatedAt",
    "paidAt",
    "paymentClaimedAt",
    "gracePeriodUntil",
    "graceDeactivatedAt",
    "transferredToDocumentsAt",
  ] as const;
  for (const k of keys) {
    const v = out[k];
    if (v != null && typeof v === "object") {
      if (typeof (v as { toDate?: () => Date }).toDate === "function") {
        try {
          out[k] = (v as { toDate: () => Date }).toDate().toISOString();
        } catch {
          /* ignore */
        }
      } else if (
        typeof (v as Record<string, unknown>)["seconds"] === "number" ||
        typeof (v as Record<string, unknown>)["_seconds"] === "number"
      ) {
        const vv = v as Record<string, unknown>;
        const s = Number(vv["seconds"] ?? vv["_seconds"]);
        if (Number.isFinite(s)) out[k] = new Date(s * 1000).toISOString();
      }
    }
  }
  return out;
}
