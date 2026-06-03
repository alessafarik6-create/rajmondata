import { buildCompanyRegisteredAddress } from "@/lib/inquiry-offer-footer";

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
}

export type HandoverCompanyPdfMeta = {
  logoUrl: string | null;
  contractorCompanyName: string;
  companyAddressText: string;
};

/** Logo a firemní údaje pro PDF / náhled protokolu (bez finančních polí). */
export function handoverCompanyPdfMeta(
  companyDoc: Record<string, unknown> | null | undefined
): HandoverCompanyPdfMeta {
  const c = companyDoc ?? {};
  const name =
    trim(c.name ?? c.displayName ?? c.companyName) || "Organizace";
  const logoUrl = trim(c.organizationLogoUrl) || null;
  const address = buildCompanyRegisteredAddress(c) ?? "";
  const ico = trim(c.ico ?? c.companyIco);
  const dic = trim(c.dic ?? c.companyDic);
  const email = trim(c.email ?? c.contactEmail ?? c.companyEmail);
  const phone = trim(c.phone ?? c.companyPhone);
  const web = trim(c.web ?? c.website ?? c.companyWeb);

  const lines = [
    name,
    address,
    ico ? `IČO: ${ico}` : "",
    dic ? `DIČ: ${dic}` : "",
    phone ? `Tel.: ${phone}` : "",
    email,
    web,
  ].filter(Boolean);

  return {
    logoUrl,
    contractorCompanyName: name,
    companyAddressText: lines.join("\n"),
  };
}
