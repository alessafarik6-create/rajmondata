/** Zařazení přílohy z e-mailu do modulu Doklady. */

export type EmailDocumentAssignmentTarget =
  | "job"
  | "overhead"
  | "company"
  | "pending";

export const EMAIL_OVERHEAD_EXPENSE_CATEGORIES = [
  "rent",
  "energy",
  "telecom",
  "fuel",
  "vehicles",
  "software",
  "accounting",
  "office",
  "insurance",
  "marketing",
  "tools",
  "other",
] as const;

export type EmailOverheadExpenseCategory =
  (typeof EMAIL_OVERHEAD_EXPENSE_CATEGORIES)[number];

export const EMAIL_OVERHEAD_EXPENSE_LABELS: Record<
  EmailOverheadExpenseCategory,
  string
> = {
  rent: "Nájem",
  energy: "Energie",
  telecom: "Telefon / internet",
  fuel: "PHM",
  vehicles: "Vozidla",
  software: "Software",
  accounting: "Účetnictví",
  office: "Kancelář",
  insurance: "Pojištění",
  marketing: "Marketing",
  tools: "Nářadí / vybavení",
  other: "Ostatní režie",
};

export const EMAIL_JOB_COST_CATEGORIES = [
  "material",
  "work",
  "transport",
  "services",
  "other",
] as const;

export type EmailJobCostCategory = (typeof EMAIL_JOB_COST_CATEGORIES)[number];

export const EMAIL_JOB_COST_LABELS: Record<EmailJobCostCategory, string> = {
  material: "Materiál",
  work: "Práce",
  transport: "Doprava",
  services: "Služby",
  other: "Ostatní",
};

export function emailDocumentAssignmentSummary(params: {
  target: EmailDocumentAssignmentTarget;
  jobLabel?: string | null;
  overheadCategory?: EmailOverheadExpenseCategory | null;
}): string {
  switch (params.target) {
    case "job":
      return params.jobLabel?.trim()
        ? `Zakázka: ${params.jobLabel.trim()}`
        : "Zakázka";
    case "overhead":
      return params.overheadCategory
        ? `Režie – ${EMAIL_OVERHEAD_EXPENSE_LABELS[params.overheadCategory]}`
        : "Režie firmy";
    case "company":
      return "Firemní doklad";
    case "pending":
      return "Nezařazený";
  }
}