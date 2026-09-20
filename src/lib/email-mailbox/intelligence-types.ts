/**
 * AI centrum firemní komunikace — kanonické enumy a složky menu.
 */

import type { Timestamp } from "firebase-admin/firestore";

export const EMAIL_AI_CATEGORIES = [
  "INQUIRY",
  "JOB",
  "INVOICE",
  "DOCUMENT",
  "ORDER",
  "COMPLAINT",
  "SUPPLIER",
  "CUSTOMER",
  "INTERNAL",
  "OTHER",
] as const;

export type EmailAiCategory = (typeof EMAIL_AI_CATEGORIES)[number];

export const EMAIL_AI_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type EmailAiPriority = (typeof EMAIL_AI_PRIORITIES)[number];

export const EMAIL_WORKFLOW_STATES = [
  "new",
  "pending_action",
  "waiting_reply",
  "delegated",
  "scheduled",
  "resolved",
] as const;

export type EmailWorkflowState = (typeof EMAIL_WORKFLOW_STATES)[number];

export const EMAIL_WORKFLOW_STATE_LABELS: Record<EmailWorkflowState, string> = {
  new: "Nový",
  pending_action: "Čeká na vyřízení",
  waiting_reply: "Čeká na odpověď",
  delegated: "Předáno",
  scheduled: "Naplánováno",
  resolved: "Vyřešeno",
};

export type EmailMessageWorkflowView =
  | "inbox"
  | "waiting_reply"
  | "needs_action"
  | "assigned_to_me"
  | "delegated"
  | "ai_suggestions"
  | "cat_jobs"
  | "cat_inquiries"
  | "cat_invoices_docs"
  | "cat_orders"
  | "cat_complaints"
  | "cat_suppliers"
  | "sent"
  | "drafts"
  | "archive"
  | "spam"
  | "trash"
  /** @deprecated legacy */
  | "ai_review"
  | "assigned"
  | "unassigned"
  | "resolved";

export type EmailFolderDef = {
  id: EmailMessageWorkflowView;
  label: string;
  /** Počítat jen nevyřízené (aktivní) položky */
  countActive?: boolean;
};

export const EMAIL_PORTAL_FOLDERS: readonly EmailFolderDef[] = [
  { id: "inbox", label: "Doručené", countActive: true },
  { id: "waiting_reply", label: "Čeká na odpověď", countActive: true },
  { id: "needs_action", label: "K vyřízení", countActive: true },
  { id: "assigned_to_me", label: "Přiřazené mně", countActive: true },
  { id: "delegated", label: "Předané kolegům", countActive: true },
  { id: "ai_suggestions", label: "AI návrhy", countActive: true },
  { id: "cat_jobs", label: "Zakázky", countActive: true },
  { id: "cat_inquiries", label: "Poptávky", countActive: true },
  { id: "cat_invoices_docs", label: "Faktury a doklady", countActive: true },
  { id: "cat_orders", label: "Objednávky", countActive: true },
  { id: "cat_complaints", label: "Servis / reklamace", countActive: true },
  { id: "cat_suppliers", label: "Dodavatelé", countActive: true },
  { id: "sent", label: "Odeslané" },
  { id: "drafts", label: "Koncepty", countActive: true },
  { id: "archive", label: "Archiv" },
  { id: "spam", label: "Spam" },
  { id: "trash", label: "Koš" },
];

export const EMAIL_SUBCOLLECTION_THREADS = "email_threads";
export const EMAIL_SUBCOLLECTION_ASSIGNMENTS = "email_assignments";
export const EMAIL_SUBCOLLECTION_REMINDERS = "email_reminders";
export const EMAIL_SUBCOLLECTION_AI_ANALYSIS = "email_ai_analysis";
export const EMAIL_SUBCOLLECTION_AUTOMATION_RULES = "email_automation_rules";
export const EMAIL_SUBCOLLECTION_AUTOMATION_RUNS = "email_automation_runs";
export const EMAIL_SUBCOLLECTION_MESSAGE_TIMELINE = "timeline";

export type EmailAssignmentDoc = {
  organizationId: string;
  emailAccountId: string;
  messageId: string;
  ownerUserId: string;
  assignedByUserId: string;
  assigneeUserId: string;
  assigneeEmployeeId?: string | null;
  note?: string | null;
  dueAt?: Timestamp | null;
  status: "pending" | "in_progress" | "done" | "cancelled";
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type EmailReminderDoc = {
  organizationId: string;
  userId: string;
  emailAccountId: string;
  messageId: string;
  remindAt: Timestamp;
  preset?: string | null;
  fired?: boolean;
  createdAt?: Timestamp;
};

export type EmailAutomationRuleDoc = {
  organizationId: string;
  name: string;
  enabled: boolean;
  /** Podmínky — rozšiřitelné bez migrace schématu */
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>[];
  createdByUserId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type EmailMessageTimelineEvent = {
  organizationId: string;
  messageId: string;
  userId?: string | null;
  kind: string;
  label: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: Timestamp;
};

export function normalizeAiCategory(raw: string | null | undefined): EmailAiCategory {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  const map: Record<string, EmailAiCategory> = {
    INQUIRY: "INQUIRY",
    POPTAVKA: "INQUIRY",
    JOB: "JOB",
    ZAKAZKA: "JOB",
    INVOICE: "INVOICE",
    FAKTURACE: "INVOICE",
    FAKTURA: "INVOICE",
    DOCUMENT: "DOCUMENT",
    DOKLAD: "DOCUMENT",
    ORDER: "ORDER",
    OBJEDNAVKA: "ORDER",
    COMPLAINT: "COMPLAINT",
    REKLAMACE: "COMPLAINT",
    SERVIS: "COMPLAINT",
    SUPPLIER: "SUPPLIER",
    DODAVATEL: "SUPPLIER",
    CUSTOMER: "CUSTOMER",
    INTERNAL: "INTERNAL",
    INTERNI: "INTERNAL",
    SPAM: "OTHER",
    OTHER: "OTHER",
    JINE: "OTHER",
  };
  if (EMAIL_AI_CATEGORIES.includes(s as EmailAiCategory)) return s as EmailAiCategory;
  return map[s] ?? map[s.replace(/[^A-Z_]/g, "")] ?? "OTHER";
}

export function normalizeAiPriority(
  raw: string | null | undefined
): EmailAiPriority {
  const s = String(raw ?? "normal").trim().toLowerCase();
  if (s === "low") return "LOW";
  if (s === "high") return "HIGH";
  if (s === "urgent") return "URGENT";
  return "NORMAL";
}

export function priorityEmoji(p: EmailAiPriority | null | undefined): string {
  switch (p) {
    case "URGENT":
      return "🔴";
    case "HIGH":
      return "🟠";
    default:
      return "⚪";
  }
}
