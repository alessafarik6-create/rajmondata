import type { PublicOperatorInfo } from "@/lib/marketing/load-billing-provider-public";
import type { LegalDocumentMeta } from "@/lib/marketing/legal-versions";

export type LegalSection = {
  id?: string;
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalDocumentRender = {
  meta: LegalDocumentMeta;
  disclaimer: string;
  sections: LegalSection[];
  operator: PublicOperatorInfo;
};
