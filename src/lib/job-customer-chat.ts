/**
 * Zákaznický chat — jedna konverzace na zákazníka (`cust_{uid}`), zprávy s volitelným `jobId`.
 */

export const CUSTOMER_CONVERSATION_PREFIX = "cust_";

export function customerConversationId(customerPortalUid: string): string {
  return `${CUSTOMER_CONVERSATION_PREFIX}${customerPortalUid.trim()}`;
}

export function resolveCustomerPortalUidFromJob(
  job: Record<string, unknown> | null | undefined
): string | null {
  if (!job) return null;
  const portalIds = Array.isArray(job.customerPortalUserIds)
    ? (job.customerPortalUserIds as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.trim() !== ""
      )
    : [];
  if (portalIds[0]) return portalIds[0].trim();
  return null;
}

/** Zpráva patří do vlákna dané zakázky (null jobId = starší globální zprávy v konverzaci). */
export function customerChatMessageMatchesJob(
  message: Record<string, unknown>,
  jobId: string,
  opts?: { includeLegacyWithoutJobId?: boolean }
): boolean {
  const msgJob = message.jobId != null ? String(message.jobId).trim() : "";
  if (msgJob === jobId) return true;
  if (opts?.includeLegacyWithoutJobId && !msgJob) return true;
  return false;
}

export function authorRoleLabelCs(role: string | null | undefined): string {
  const r = String(role ?? "").trim();
  if (r === "customer") return "Zákazník";
  if (r === "admin") return "Administrátor";
  if (r === "employee") return "Zaměstnanec";
  return r || "—";
}
