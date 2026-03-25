/**
 * Jednotné skládání adresy zákazníka pro detail zakázky (dokument zákazník + pole na zakázce).
 */

import { deriveCustomerDisplayNameFromJob } from "@/lib/job-customer-client";

function deriveCustomerDisplayNameFromCustomerDoc(c: unknown): string {
  if (!c || typeof c !== "object") return "";
  const o = c as Record<string, unknown>;
  const company = String(o.companyName ?? "").trim();
  if (company) return company;
  const first = String(o.firstName ?? "").trim();
  const last = String(o.lastName ?? "").trim();
  return [first, last].filter(Boolean).join(" ").trim();
}

/**
 * Stejná logika jako buildFullCompanyAddress v detailu zakázky — strukturované pole + legacy.
 */
export function buildCustomerAddressMultiline(entity: unknown): string {
  if (!entity || typeof entity !== "object") return "";
  const co = entity as Record<string, unknown>;

  const streetAndNumber = co.companyAddressStreetAndNumber;
  const city = co.companyAddressCity;
  const postalCode = co.companyAddressPostalCode;
  const country = co.companyAddressCountry;

  const structured =
    streetAndNumber || city || postalCode || country
      ? [
          streetAndNumber ? String(streetAndNumber).trim() : "",
          [postalCode ? String(postalCode).trim() : "", city ? String(city).trim() : ""]
            .filter(Boolean)
            .join(" "),
          country ? String(country).trim() : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  if (structured) return structured;

  const legacy =
    co.registeredOfficeAddress ||
    co.registeredOffice ||
    co.address ||
    co.sidlo ||
    "";
  return String(legacy ?? "").trim();
}

export function multilineToLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export type JobCustomerAddressBlock = {
  /** Zobrazované jméno / firma */
  displayName: string;
  /** Čitelné řádky adresy (ulice, PSČ město, …) */
  addressLines: string[];
  hasAddress: boolean;
};

/**
 * Název zákazníka a adresa pro UI detailu zakázky.
 * Priorita adresy: záznam zákazníka (strukturovaně), pak text na zakázce (`customerAddress`).
 */
export function buildJobCustomerAddressBlock(
  job: unknown,
  customer: unknown | null | undefined
): JobCustomerAddressBlock {
  const j = (job ?? {}) as Record<string, unknown>;
  const fromJobName = deriveCustomerDisplayNameFromJob({
    customerName: (j.customerName as string | null) ?? null,
  });
  const fromCustomerName = customer
    ? deriveCustomerDisplayNameFromCustomerDoc(customer)
    : "";

  const displayName = (fromCustomerName || fromJobName).trim();

  let addressLines: string[] = [];
  if (customer) {
    addressLines = multilineToLines(buildCustomerAddressMultiline(customer));
  }
  if (addressLines.length === 0) {
    const snap = String(j.customerAddress ?? "").trim();
    if (snap) addressLines = multilineToLines(snap);
  }

  return {
    displayName,
    addressLines,
    hasAddress: addressLines.length > 0,
  };
}
