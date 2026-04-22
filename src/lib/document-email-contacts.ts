/**
 * Uložené e-mailové kontakty pro rychlé odesílání dokladů (sekce Doklady).
 * Ukládá se do: companies/{companyId}/documentEmailContacts/{contactId}
 */

export const DOCUMENT_EMAIL_CONTACT_TYPES = [
  "accounting",
  "customer",
  "supplier",
  "internal",
  "other",
] as const;

export type DocumentEmailContactType = (typeof DOCUMENT_EMAIL_CONTACT_TYPES)[number];

export const DOCUMENT_EMAIL_CONTACT_TYPE_LABELS: Record<DocumentEmailContactType, string> = {
  accounting: "Účetní",
  customer: "Zákazník",
  supplier: "Dodavatel",
  internal: "Interní",
  other: "Jiný",
};

export type DocumentEmailContactRow = {
  id: string;
  companyId: string;
  email: string;
  /** Název kontaktu / štítek */
  label: string;
  contactType?: DocumentEmailContactType | string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function normalizeDocumentEmailContactType(
  raw: string | null | undefined
): DocumentEmailContactType {
  const s = String(raw ?? "").trim().toLowerCase();
  if ((DOCUMENT_EMAIL_CONTACT_TYPES as readonly string[]).includes(s)) {
    return s as DocumentEmailContactType;
  }
  return "other";
}
