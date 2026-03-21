import { createHash } from "node:crypto";

/**
 * Stabilní Firebase Auth UID pro kiosk účet dané firmy (jeden na companyId).
 * Max délka UID u Firebase je 128 znaků.
 */
export function kioskAuthUidForCompany(companyId: string): string {
  const h = createHash("sha256").update(companyId, "utf8").digest("hex").slice(0, 32);
  return `tkiosk_${h}`;
}
