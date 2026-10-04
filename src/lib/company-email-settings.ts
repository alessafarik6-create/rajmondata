/**
 * Nastavení e-mailu organizace — subdokument + sloučení s inquiryEmailIdentity na firmě.
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  readInquiryEmailIdentity,
  type InquiryEmailIdentity,
} from "@/lib/inquiry-offer-email";
import { splitOfferCopyEmailsInput, validateOfferCopyEmailsRaw } from "@/lib/inquiry-offer-copy";

export const COMPANY_EMAIL_SETTINGS_COLLECTION = "settings";
export const COMPANY_EMAIL_SETTINGS_DOC_ID = "email";

export type CompanyEmailSettingsDoc = {
  offerAuditCopyEnabled?: boolean;
  offerAuditEmails?: string[];
};

export type InquiryOfferEmailConfig = InquiryEmailIdentity & {
  offerAuditCopyEnabled: boolean;
  offerAuditEmails: string[];
};

function auditEmailsFromIdentity(identity: InquiryEmailIdentity): string[] {
  const validated = validateOfferCopyEmailsRaw(identity.offerCopyEmails);
  return validated.ok ? validated.emails : [];
}

export function mergeInquiryOfferEmailConfig(
  company: Record<string, unknown> | null | undefined,
  emailSettings?: CompanyEmailSettingsDoc | null
): InquiryOfferEmailConfig {
  const identity = readInquiryEmailIdentity(company);
  const fromSubdoc = Array.isArray(emailSettings?.offerAuditEmails)
    ? emailSettings!.offerAuditEmails!.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
    : [];
  const fromIdentity = auditEmailsFromIdentity(identity);
  const offerAuditEmails = [...new Set([...fromSubdoc, ...fromIdentity])];

  const enabledFromSub =
    emailSettings?.offerAuditCopyEnabled === true || emailSettings?.offerAuditCopyEnabled === false
      ? emailSettings.offerAuditCopyEnabled
      : undefined;
  const enabledFromIdentity = identity.offerAuditCopyEnabled;
  const offerAuditCopyEnabled =
    enabledFromSub ?? enabledFromIdentity ?? (offerAuditEmails.length > 0);

  return {
    ...identity,
    offerAuditCopyEnabled,
    offerAuditEmails,
    offerCopyEmails:
      offerAuditEmails.length > 0 ? offerAuditEmails.join(", ") : identity.offerCopyEmails ?? null,
  };
}

export async function loadCompanyEmailSettingsDoc(
  db: Firestore,
  companyId: string
): Promise<CompanyEmailSettingsDoc | null> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(COMPANY_EMAIL_SETTINGS_COLLECTION)
    .doc(COMPANY_EMAIL_SETTINGS_DOC_ID)
    .get();
  if (!snap.exists) return null;
  return (snap.data() ?? {}) as CompanyEmailSettingsDoc;
}

export async function loadInquiryOfferEmailConfig(
  db: Firestore,
  companyId: string,
  company?: Record<string, unknown> | null
): Promise<InquiryOfferEmailConfig> {
  let companyData = company;
  if (!companyData) {
    const snap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
    companyData = (snap.data() ?? {}) as Record<string, unknown>;
  }
  const emailSettings = await loadCompanyEmailSettingsDoc(db, companyId);
  return mergeInquiryOfferEmailConfig(companyData, emailSettings);
}

/** Payload pro uložení z UI (admin). */
export function buildCompanyEmailSettingsPayload(input: {
  offerAuditCopyEnabled: boolean;
  offerAuditEmails: string[];
}): CompanyEmailSettingsDoc {
  const emails = [...new Set(input.offerAuditEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  return {
    offerAuditCopyEnabled: input.offerAuditCopyEnabled,
    offerAuditEmails: emails,
  };
}

export function parseOfferAuditEmailsFromUi(values: string[]): string[] {
  const all: string[] = [];
  for (const row of values) {
    all.push(...splitOfferCopyEmailsInput(row));
  }
  const validated = validateOfferCopyEmailsRaw(all.join(", "));
  return validated.ok ? validated.emails : [];
}
