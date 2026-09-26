import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import {
  EMAIL_OVERHEAD_EXPENSE_LABELS,
  type EmailDocumentAssignmentTarget,
  type EmailOverheadExpenseCategory,
} from "@/lib/email-mailbox/email-document-assignment";
import { EMAIL_ATTACHMENT_JOB_CATEGORY_LABELS } from "@/lib/email-mailbox/attachment-meta";

/** Obsah přílohy — ne každý PDF je účetní doklad. */
export type EmailAttachmentContentKind =
  | "ACCOUNTING_DOCUMENT"
  | "PROJECT_DOCUMENT"
  | "DRAWING"
  | "CONTRACT"
  | "PHOTO"
  | "OTHER";

export const EMAIL_JOB_ATTACHMENT_ROLES = [
  "invoice",
  "material",
  "drawing",
  "project_doc",
  "photo",
  "contract",
  "order",
  "other",
] as const;

export type EmailJobAttachmentRole = (typeof EMAIL_JOB_ATTACHMENT_ROLES)[number];

export const EMAIL_JOB_ATTACHMENT_ROLE_LABELS: Record<EmailJobAttachmentRole, string> = {
  invoice: "Faktura / doklad",
  material: "Materiál",
  drawing: "Výkres / projektová dokumentace",
  project_doc: "Projektová dokumentace",
  photo: "Fotodokumentace",
  contract: "Smlouva",
  order: "Objednávka",
  other: "Ostatní",
};

export const EMAIL_COMPANY_DOC_TYPES = [
  "invoice",
  "contract",
  "order",
  "project_doc",
  "certificate",
  "other",
] as const;

export type EmailCompanyDocType = (typeof EMAIL_COMPANY_DOC_TYPES)[number];

export const EMAIL_COMPANY_DOC_TYPE_LABELS: Record<EmailCompanyDocType, string> = {
  invoice: "Faktura",
  contract: "Smlouva",
  order: "Objednávka",
  project_doc: "Projektová dokumentace",
  certificate: "Certifikát",
  other: "Ostatní",
};

export const EMAIL_OVERHEAD_DOC_TYPES = ["received_invoice", "receipt", "other"] as const;

export type EmailOverheadDocType = (typeof EMAIL_OVERHEAD_DOC_TYPES)[number];

export const EMAIL_OVERHEAD_DOC_TYPE_LABELS: Record<EmailOverheadDocType, string> = {
  received_invoice: "Přijatá faktura",
  receipt: "Účtenka",
  other: "Jiný doklad",
};

export type EmailAttachmentPlacement = {
  target: EmailDocumentAssignmentTarget;
  jobId?: string | null;
  jobLabel?: string | null;
  jobAttachmentRole?: EmailJobAttachmentRole | null;
  contentKind?: EmailAttachmentContentKind | null;
  overheadCategory?: EmailOverheadExpenseCategory | string | null;
  overheadDocType?: EmailOverheadDocType | null;
  companyDocType?: EmailCompanyDocType | null;
  /** Firestore documents/{id} pouze pro účetní / nezařazené / firemní soubor v dokladech */
  accountingDocumentId?: string | null;
  classifiedAt?: string | null;
};

export function jobRoleToContentKind(role: EmailJobAttachmentRole): EmailAttachmentContentKind {
  switch (role) {
    case "invoice":
      return "ACCOUNTING_DOCUMENT";
    case "drawing":
    case "project_doc":
      return role === "drawing" ? "DRAWING" : "PROJECT_DOCUMENT";
    case "contract":
      return "CONTRACT";
    case "photo":
      return "PHOTO";
    default:
      return "OTHER";
  }
}

export function jobRoleCreatesAccountingDocument(role: EmailJobAttachmentRole): boolean {
  return role === "invoice";
}

export function companyDocTypeCreatesAccounting(type: EmailCompanyDocType): boolean {
  return type === "invoice";
}

export function overheadAlwaysAccounting(): boolean {
  return true;
}

export function attachmentHasPlacement(att: EmailMessageAttachmentMeta): boolean {
  const p = att.emailPlacement;
  if (p?.target) return true;
  if (att.documentAssignmentLabel?.trim()) return true;
  if (att.linkedJobId && att.linkedJobMediaImageId) return true;
  if (att.linkedDocumentId?.trim() || att.createdDocumentId?.trim()) return true;
  if (att.analysisStatus === "saved" && (att.createdDocumentType || att.linkedJobId)) return true;
  return false;
}

export function attachmentAccountingDocumentId(
  att: EmailMessageAttachmentMeta,
  messageId: string,
  fallbackDeterministicId: string | null
): string | null {
  const fromPlacement = att.emailPlacement?.accountingDocumentId?.trim();
  if (fromPlacement) return fromPlacement;
  const explicit = att.linkedDocumentId?.trim() || att.createdDocumentId?.trim();
  if (!explicit) return null;
  const kind =
    att.emailPlacement?.contentKind ??
    (att.createdDocumentType === "job_cost" || att.createdDocumentType === "overhead"
      ? "ACCOUNTING_DOCUMENT"
      : null);
  if (kind && kind !== "ACCOUNTING_DOCUMENT") return null;
  if (att.documentCategory && att.documentCategory !== "invoice" && !kind) {
    const nonAccountingCats = ["drawing", "document", "photo", "contract", "order", "offer", "other"];
    if (nonAccountingCats.includes(att.documentCategory) && !att.emailPlacement?.target) {
      return null;
    }
  }
  return explicit || fallbackDeterministicId;
}

export function formatAttachmentPlacementStatus(att: EmailMessageAttachmentMeta): {
  line1: string;
  line2?: string;
  line3?: string;
} | null {
  const p = att.emailPlacement;
  if (p?.target) {
    switch (p.target) {
      case "job":
        return {
          line1: "✓ Zakázka",
          line2: p.jobLabel?.trim() || att.linkedJobLabel?.trim() || undefined,
          line3:
            p.jobAttachmentRole
              ? EMAIL_JOB_ATTACHMENT_ROLE_LABELS[p.jobAttachmentRole]
              : att.documentCategory
                ? EMAIL_ATTACHMENT_JOB_CATEGORY_LABELS[
                    att.documentCategory as keyof typeof EMAIL_ATTACHMENT_JOB_CATEGORY_LABELS
                  ]
                : undefined,
        };
      case "overhead":
        return {
          line1: "✓ Režie firmy",
          line2: p.overheadCategory
            ? EMAIL_OVERHEAD_EXPENSE_LABELS[p.overheadCategory as EmailOverheadExpenseCategory] ??
              String(p.overheadCategory)
            : undefined,
          line3: p.overheadDocType
            ? EMAIL_OVERHEAD_DOC_TYPE_LABELS[p.overheadDocType]
            : undefined,
        };
      case "company":
        return {
          line1: "✓ Firemní dokument",
          line2: p.companyDocType
            ? EMAIL_COMPANY_DOC_TYPE_LABELS[p.companyDocType]
            : undefined,
        };
      case "pending":
        return { line1: "Nezařazeno" };
    }
  }
  const label = att.documentAssignmentLabel?.trim();
  if (label) return { line1: label.startsWith("✓") ? label : `✓ ${label}` };
  if (att.linkedJobId && att.linkedJobLabel) {
    return {
      line1: "✓ Zakázka",
      line2: att.linkedJobLabel,
    };
  }
  if (att.linkedDocumentId || att.createdDocumentId) {
    return { line1: "✓ Zařazeno (upravte volbou Změnit zařazení)" };
  }
  return null;
}

export function buildPlacementStatusLines(params: {
  target: EmailDocumentAssignmentTarget;
  jobLabel?: string | null;
  jobAttachmentRole?: EmailJobAttachmentRole | null;
  overheadCategory?: string | null;
  overheadDocType?: EmailOverheadDocType | null;
  companyDocType?: EmailCompanyDocType | null;
}): EmailAttachmentPlacement {
  const contentKind =
    params.target === "job" && params.jobAttachmentRole
      ? jobRoleToContentKind(params.jobAttachmentRole)
      : params.target === "overhead"
        ? "ACCOUNTING_DOCUMENT"
        : params.companyDocType === "invoice"
          ? "ACCOUNTING_DOCUMENT"
          : params.companyDocType
            ? jobRoleToContentKind(
                params.companyDocType === "contract"
                  ? "contract"
                  : params.companyDocType === "project_doc"
                    ? "project_doc"
                    : "other"
              )
            : params.target === "pending"
              ? "OTHER"
              : null;

  return {
    target: params.target,
    jobLabel: params.jobLabel ?? null,
    jobAttachmentRole: params.jobAttachmentRole ?? null,
    contentKind,
    overheadCategory: params.overheadCategory ?? null,
    overheadDocType: params.overheadDocType ?? null,
    companyDocType: params.companyDocType ?? null,
    classifiedAt: new Date().toISOString(),
  };
}
