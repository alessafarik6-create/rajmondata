export type AiSecretaryMemoryScope = "organization" | "user";

export type AiSecretaryMemoryType = "command_alias" | "workflow" | "preference";

export type AiSecretaryMemoryStatus = "active" | "disabled";

export type AiSecretaryWorkflowStep = {
  action: string;
  paramsTemplate?: Record<string, unknown>;
};

export type AiSecretaryMemoryDoc = {
  organizationId: string;
  scope: AiSecretaryMemoryScope;
  userId?: string | null;
  type: AiSecretaryMemoryType;
  name: string;
  triggerPhrases: string[];
  description?: string | null;
  steps: AiSecretaryWorkflowStep[];
  requiredCapabilities: string[];
  confirmationPolicy?: "always" | "write_only" | "none";
  status: AiSecretaryMemoryStatus;
  createdByUserId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  version: number;
  useCount: number;
  lastUsedAt?: string | null;
  previousVersionId?: string | null;
};

export const AI_SECRETARY_MEMORIES_COLLECTION = "aiSecretaryMemories";

export const ALLOWED_WORKFLOW_ACTIONS = new Set([
  "search_jobs",
  "get_job_detail",
  "get_recent_jobs",
  "get_calendar_events",
  "getTodayOverview",
  "search_tasks",
  "get_recent_emails",
  "search_emails",
  "create_employee_task_draft",
  "create_calendar_meeting_draft",
  "create_email_compose_draft",
]);
