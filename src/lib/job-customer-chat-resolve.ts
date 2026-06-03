/**
 * Rozpoznání zákazníka u zakázky pro chat (více polí + CRM + portál).
 */

import {
  getJobCustomerPortalPreviewGate,
  resolveCustomerPortalUidForPreview,
} from "@/lib/job-customer-portal-preview";

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function nestedCustomer(job: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const c = job?.customer;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    return c as Record<string, unknown>;
  }
  return null;
}

function firstPortalUidFromJob(job: Record<string, unknown> | null | undefined): string | null {
  if (!job) return null;
  const ids = Array.isArray(job.customerPortalUserIds)
    ? (job.customerPortalUserIds as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.trim() !== ""
      )
    : [];
  if (ids[0]) return ids[0].trim();
  return (
    trimStr(job.customerUid) ||
    trimStr(job.customerPortalUid) ||
    trimStr(job.portalCustomerId) ||
    trimStr(job.customerUserId) ||
    trimStr(job.customerAuthUid) ||
    trimStr(job.customerPortalUserId) ||
    null
  );
}

/** Všechna známá CRM / portálová ID z zakázky a vnořeného zákazníka. */
export function extractJobCustomerCrmId(
  job: Record<string, unknown> | null | undefined,
  customerDoc?: Record<string, unknown> | null
): string | null {
  const nested = nestedCustomer(job);
  const candidates = [
    trimStr(job?.customerId),
    trimStr(job?.clientId),
    trimStr(job?.portalCustomerId),
    trimStr(job?.customerRecordId),
    trimStr(job?.customer_id),
    trimStr(job?.customerID),
    trimStr(job?.crmCustomerId),
    trimStr(nested?.id),
    trimStr(nested?.customerId),
    trimStr(nested?.clientId),
    trimStr(customerDoc?.id),
  ].filter(Boolean);
  return candidates[0] ?? null;
}

export function extractJobCustomerEmail(
  job: Record<string, unknown> | null | undefined,
  customerDoc?: Record<string, unknown> | null
): string | null {
  const nested = nestedCustomer(job);
  const candidates = [
    trimStr(job?.customerEmail),
    trimStr(job?.clientEmail),
    trimStr(job?.email),
    trimStr(nested?.email),
    trimStr(nested?.customerEmail),
    trimStr(customerDoc?.email),
    trimStr(customerDoc?.customerPortalEmail),
  ].filter(Boolean);
  const email = candidates[0]?.toLowerCase() ?? "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function extractJobCustomerDisplayName(
  job: Record<string, unknown> | null | undefined,
  customerDoc?: Record<string, unknown> | null
): string {
  const nested = nestedCustomer(job);
  const parts = [
    trimStr(customerDoc?.companyName),
    trimStr(customerDoc?.name),
    [trimStr(customerDoc?.firstName), trimStr(customerDoc?.lastName)].filter(Boolean).join(" "),
    trimStr(job?.customerName),
    trimStr(job?.clientName),
    trimStr(nested?.name),
    trimStr(nested?.companyName),
  ].filter(Boolean);
  return parts[0] || "Zákazník";
}

export type JobCustomerChatContext = {
  displayName: string;
  email: string | null;
  crmCustomerId: string | null;
  portalUid: string | null;
  /** Má smysl zobrazit sekci (zakázka má zákazníka v datech). */
  hasCustomerAssignment: boolean;
  canChat: boolean;
  needsPortalAccount: boolean;
};

export function buildJobCustomerChatContext(
  job: Record<string, unknown> | null | undefined,
  opts?: {
    customer?: Record<string, unknown> | null;
    customerPortalUserDocId?: string | null;
    /** Server / API může doplnit UID z dotazu podle e-mailu. */
    portalUidFromEmailLookup?: string | null;
  }
): JobCustomerChatContext {
  const customer = opts?.customer ?? null;
  const crmCustomerId = extractJobCustomerCrmId(job, customer);
  const email = extractJobCustomerEmail(job, customer);
  const displayName = extractJobCustomerDisplayName(job, customer);

  const portalUid =
    opts?.portalUidFromEmailLookup?.trim() ||
    resolveCustomerPortalUidForPreview(job, {
      customer,
      customerPortalUserDocId: opts?.customerPortalUserDocId ?? null,
    }) ||
    firstPortalUidFromJob(job);

  const gate = getJobCustomerPortalPreviewGate(job, {
    customer,
    customerPortalUserDocId: opts?.customerPortalUserDocId ?? null,
  });

  const hasCustomerAssignment = Boolean(
    crmCustomerId ||
      email ||
      gate.show ||
      trimStr(job?.customerName) ||
      trimStr(job?.clientName) ||
      job?.customerAccessEnabled === true ||
      Array.isArray(job?.customerPortalUserIds) && (job.customerPortalUserIds as unknown[]).length > 0
  );

  const needsPortalAccount =
    hasCustomerAssignment &&
    !portalUid &&
    Boolean(
      crmCustomerId ||
        (gate.show && gate.disabled && gate.reason === "no_portal_login")
    );

  const canChat = Boolean(portalUid);

  return {
    displayName,
    email,
    crmCustomerId,
    portalUid,
    hasCustomerAssignment,
    canChat,
    needsPortalAccount,
  };
}
