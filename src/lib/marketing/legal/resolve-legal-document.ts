import type { PublicOperatorInfo } from "@/lib/marketing/load-billing-provider-public";
import { buildCookiesDocument } from "@/lib/marketing/legal/build-cookies-document";
import { buildDpaDocument } from "@/lib/marketing/legal/build-dpa-document";
import { buildPrivacyDocument } from "@/lib/marketing/legal/build-privacy-document";
import { buildTermsDocument } from "@/lib/marketing/legal/build-terms-document";
import type { LegalDocumentRender } from "@/lib/marketing/legal/legal-section-types";

export function resolveLegalDocument(
  legalKey: NonNullable<import("@/lib/marketing/public-pages-registry").MarketingPageDef["legalKey"]>,
  operator: PublicOperatorInfo
): LegalDocumentRender {
  switch (legalKey) {
    case "terms":
      return buildTermsDocument(operator);
    case "privacy":
      return buildPrivacyDocument(operator);
    case "cookies":
      return buildCookiesDocument(operator);
    case "dpa":
      return buildDpaDocument(operator);
    default:
      return buildTermsDocument(operator);
  }
}
