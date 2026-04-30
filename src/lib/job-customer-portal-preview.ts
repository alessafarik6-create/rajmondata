/**
 * Náhled klientského portálu z administrace zakázky (bez přihlášení jako zákazník).
 *
 * Zdroje UID: pole na zakázce, dokument zákazníka v CRM (`customerPortalUid` z create-portal-auth),
 * volitelně `users/{id}` z dotazu podle `customerRecordId`.
 */

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function firstCustomerPortalUserId(
  job: Record<string, unknown> | null | undefined
): string | null {
  const ids = Array.isArray(job?.customerPortalUserIds)
    ? (job.customerPortalUserIds as unknown[])
    : [];
  const first = ids.find((x): x is string => typeof x === "string" && x.trim().length > 0);
  return first ? first.trim() : null;
}

function firstNonEmptyJobPortalUid(job: Record<string, unknown> | null | undefined): string | null {
  if (!job) return null;
  const fromArr = firstCustomerPortalUserId(job);
  if (fromArr) return fromArr;
  const single =
    trimStr(job.customerUserId) ||
    trimStr(job.customerAuthUid) ||
    trimStr(job.customerPortalUserId);
  return single || null;
}

/** CRM: přístup vypnutý jen při explicitním `customerPortalEnabled === false`. */
function isCustomerPortalExplicitlyDisabled(
  customer: Record<string, unknown> | null | undefined
): boolean {
  return customer != null && customer.customerPortalEnabled === false;
}

function uidFromCustomerDoc(
  customer: Record<string, unknown> | null | undefined
): string | null {
  if (!customer || isCustomerPortalExplicitlyDisabled(customer)) return null;
  return (
    trimStr(customer.customerPortalUid) ||
    trimStr(customer.customerUserId) ||
    trimStr(customer.customerAuthUid) ||
    trimStr(customer.customerPortalUserId) ||
    null
  );
}

export type JobCustomerPortalPreviewOptions = {
  /** `companies/{companyId}/customers/{customerId}` — načtený u detailu zakázky */
  customer?: Record<string, unknown> | null;
  /**
   * Volitelně id dokumentu `users/{id}` (např. z query where customerRecordId == CRM id, role == customer).
   */
  customerPortalUserDocId?: string | null;
};

/**
 * Firebase UID zákazníka v portálu pro náhled (úkoly, katalogy, …).
 */
export function resolveCustomerPortalUidForPreview(
  job: Record<string, unknown> | null | undefined,
  opts?: JobCustomerPortalPreviewOptions | null
): string | null {
  const customer = opts?.customer ?? null;
  const fromJob = firstNonEmptyJobPortalUid(job);
  if (fromJob) return fromJob;

  const fromCrm = uidFromCustomerDoc(customer);
  if (fromCrm) return fromCrm;

  const docId = trimStr(opts?.customerPortalUserDocId);
  if (docId && (!customer || !isCustomerPortalExplicitlyDisabled(customer))) {
    return docId;
  }

  return null;
}

export type JobCustomerPortalPreviewGate =
  | { show: false }
  | { show: true; disabled: true; reason: "no_portal_login" }
  | { show: true; disabled: false; customerUid: string };

function hasLinkedCrmCustomer(job: Record<string, unknown> | null | undefined): boolean {
  const crm =
    typeof job?.customerId === "string" ? String(job.customerId).trim() : "";
  return crm.length > 0;
}

function customerSuggestsPortalAccount(
  customer: Record<string, unknown> | null | undefined
): boolean {
  if (!customer) return false;
  if (customer.customerPortalEnabled === true) return true;
  if (customer.portalAccessEnabled === true) return true;
  if (customer.hasCustomerPortalAccess === true) return true;
  if (trimStr(customer.customerPortalUid)) return true;
  if (trimStr(customer.customerUserId)) return true;
  return false;
}

/**
 * Kdy zobrazit tlačítko náhledu a jaký UID použít pro úkoly / výběry v portálu.
 *
 * Dříve se bralo v úvahu jen `job.customerPortalUserIds`; účet zákazníka se ale ukládá
 * na CRM jako `customerPortalUid` (viz create-portal-auth) a na job se nemusí propsat.
 */
export function getJobCustomerPortalPreviewGate(
  job: Record<string, unknown> | null | undefined,
  opts?: JobCustomerPortalPreviewOptions | null
): JobCustomerPortalPreviewGate {
  if (!job) return { show: false };

  const uid = resolveCustomerPortalUidForPreview(job, opts ?? null);
  if (uid) return { show: true, disabled: false, customerUid: uid };

  const accessEnabled = job.customerAccessEnabled === true;
  const crm = hasLinkedCrmCustomer(job);
  const customerHint = customerSuggestsPortalAccount(opts?.customer ?? null);

  if (accessEnabled || crm || customerHint) {
    return { show: true, disabled: true, reason: "no_portal_login" };
  }
  return { show: false };
}
