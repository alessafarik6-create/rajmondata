import type { EmailAiCategory } from "@/lib/email-mailbox/intelligence-types";

export const EMAIL_AI_CATEGORY_LABELS: Record<EmailAiCategory, string> = {
  INQUIRY: "Poptávka",
  JOB: "Zakázka",
  INVOICE: "Faktura",
  DOCUMENT: "Doklad",
  ORDER: "Objednávka",
  COMPLAINT: "Reklamace / servis",
  SUPPLIER: "Dodavatel",
  CUSTOMER: "Zákazník",
  INTERNAL: "Interní",
  OTHER: "Ostatní",
};

export function emailPriorityLabel(p: string | null | undefined): string {
  const u = String(p ?? "NORMAL").toUpperCase();
  if (u === "URGENT") return "Urgentní";
  if (u === "HIGH") return "Důležité";
  if (u === "LOW") return "Nízká";
  return "Normální";
}
