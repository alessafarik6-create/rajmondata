/**
 * Náhled klientského portálu z administrace zakázky (bez přihlášení jako zákazník).
 */

export function firstCustomerPortalUserId(
  job: Record<string, unknown> | null | undefined
): string | null {
  const ids = Array.isArray(job?.customerPortalUserIds)
    ? (job.customerPortalUserIds as unknown[])
    : [];
  const first = ids.find((x): x is string => typeof x === "string" && x.trim().length > 0);
  return first ? first.trim() : null;
}

export type JobCustomerPortalPreviewGate =
  | { show: false }
  | { show: true; disabled: true; reason: "no_portal_login" }
  | { show: true; disabled: false; customerUid: string };

/**
 * Kdy zobrazit tlačítko náhledu a jaký UID použít pro úkoly / výběry v portálu.
 */
export function getJobCustomerPortalPreviewGate(
  job: Record<string, unknown> | null | undefined
): JobCustomerPortalPreviewGate {
  if (!job) return { show: false };
  const uid = firstCustomerPortalUserId(job);
  if (uid) return { show: true, disabled: false, customerUid: uid };

  const accessEnabled = job.customerAccessEnabled === true;
  const crm =
    typeof job.customerId === "string" && String(job.customerId).trim().length > 0;

  if (accessEnabled || crm) {
    return { show: true, disabled: true, reason: "no_portal_login" };
  }
  return { show: false };
}
