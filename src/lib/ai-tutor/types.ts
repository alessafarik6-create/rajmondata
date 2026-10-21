import type { PortalModuleId } from "@/lib/portal-permissions";

export type AiTutorialStatus = "not_started" | "in_progress" | "completed" | "skipped";

export type AiTutorialProgressDoc = {
  userId: string;
  organizationId: string;
  tutorialId: string;
  tutorialVersion: number;
  status: AiTutorialStatus;
  completedSteps: string[];
  lastStep: string | null;
  completedAt?: string | null;
  skippedAt?: string | null;
  lastShownAt?: string | null;
  updatedAt?: string | null;
};

export type AiOrgMilestoneId =
  | "first_customer_created"
  | "first_job_created"
  | "first_employee_created"
  | "first_invoice_created"
  | "email_connected"
  | "first_contract_created"
  | "first_offer_created"
  | "attendance_configured"
  | "warehouse_item_created"
  | "gps_connected";

export type AiTutorialStepDef = {
  id: string;
  title: string;
  body: string;
  /** Cesta portálu, na které krok platí. */
  routePrefix: string;
  /** CSS selektor `[data-tour-id="…"]` */
  tourTarget?: string | null;
  /** Fallback na `[data-onboarding-nav="…"]` */
  navTarget?: string | null;
  /** Uživatel musí sám provést akci (uložení) — krok neposouvá automaticky po kliknutí. */
  requiresUserAction?: boolean;
};

export type AiTutorialDef = {
  id: string;
  version: number;
  title: string;
  summary: string;
  moduleId?: PortalModuleId;
  /** Pokud prázdné, všichni kromě customer. */
  roles?: Array<"owner" | "admin" | "manager" | "employee" | "accountant">;
  /** Skrýt, pokud milník už splněn (uživatel to umí). */
  hideWhenMilestone?: AiOrgMilestoneId;
  /** Vyžaduje read/write u moduleId. */
  requiredAccess?: "read" | "write";
  enabled: boolean;
  steps: AiTutorialStepDef[];
};

export type AiSetupChecklistItem = {
  id: AiOrgMilestoneId;
  label: string;
  moduleId?: PortalModuleId;
  requiredAccess?: "read" | "write";
  roles?: AiTutorialDef["roles"];
  href?: string;
};
