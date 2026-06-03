/**
 * Zákaznický chat — jedna konverzace na zákazníka (`cust_{uid}`), zprávy s volitelným `jobId`.
 */

import { resolveCustomerPortalUidForPreview } from "@/lib/job-customer-portal-preview";

export { buildJobCustomerChatContext } from "@/lib/job-customer-chat-resolve";
export type { JobCustomerChatContext } from "@/lib/job-customer-chat-resolve";

export const CUSTOMER_CONVERSATION_PREFIX = "cust_";

export function customerConversationId(customerPortalUid: string): string {
  return `${CUSTOMER_CONVERSATION_PREFIX}${customerPortalUid.trim()}`;
}

/** @deprecated Prefer `buildJobCustomerChatContext` s CRM / users — zachováno pro starší volání. */
export function resolveCustomerPortalUidFromJob(
  job: Record<string, unknown> | null | undefined,
  opts?: {
    customer?: Record<string, unknown> | null;
    customerPortalUserDocId?: string | null;
  }
): string | null {
  return resolveCustomerPortalUidForPreview(job, opts ?? null);
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
