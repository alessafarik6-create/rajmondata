import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
import {
  resolveSecretaryPermissions,
  type SecretaryPermissions,
} from "@/lib/ai/secretary/permissions";
import {
  defaultAiSecretarySettings,
  loadAiSecretarySettings,
  type AiSecretarySettingsDoc,
} from "@/lib/ai/secretary/settings";

/** Centrální capability klíče (registry). */
export type SecretaryCapability =
  | "calendar.read"
  | "calendar.create"
  | "calendar.update"
  | "calendar.delete"
  | "tasks.read"
  | "tasks.create"
  | "tasks.update"
  | "tasks.delete"
  | "email.read"
  | "email.draft"
  | "email.send"
  | "jobs.read"
  | "jobs.open"
  | "jobs.write"
  | "customers.read"
  | "aiMemory.read"
  | "aiMemory.create"
  | "aiMemory.update"
  | "aiMemory.disable";

export const TOOL_REQUIRED_CAPABILITIES: Record<string, SecretaryCapability[]> = {
  get_calendar_events: ["calendar.read"],
  getTodayOverview: ["calendar.read"],
  search_calendar_meetings: ["calendar.read"],
  create_calendar_meeting: ["calendar.create"],
  create_calendar_meeting_draft: ["calendar.create"],
  update_calendar_meeting_draft: ["calendar.update"],
  confirm_calendar_meeting: ["calendar.create"],
  confirm_calendar_meeting_update: ["calendar.update"],
  confirm_calendar_meeting_cancel: ["calendar.delete"],
  cancel_calendar_meeting_draft: ["calendar.delete"],
  cancel_pending_action: ["calendar.create"],
  search_tasks: ["tasks.read"],
  create_employee_task_draft: ["tasks.create"],
  update_employee_task_draft: ["tasks.update"],
  update_task_draft: ["tasks.update"],
  confirm_employee_task: ["tasks.create"],
  confirm_task_update: ["tasks.update"],
  confirm_task_cancel: ["tasks.delete"],
  cancel_task_draft: ["tasks.delete"],
  search_employees: ["tasks.create"],
  get_recent_emails: ["email.read"],
  search_emails: ["email.read"],
  get_email_detail: ["email.read"],
  show_email: ["email.read"],
  show_email_attachment: ["email.read"],
  create_email_reply_draft: ["email.draft"],
  create_email_forward_draft: ["email.draft"],
  create_email_compose_draft: ["email.draft"],
  update_email_send_draft: ["email.draft"],
  confirm_email_send: ["email.send"],
  mark_email_resolved: ["email.draft"],
  assign_email_employee: ["email.draft"],
  search_jobs: ["jobs.read"],
  get_job_detail: ["jobs.read"],
  get_recent_jobs: ["jobs.read"],
  get_job_status: ["jobs.read"],
  open_job: ["jobs.open"],
  search_customers: ["customers.read"],
  search_meeting_records: ["calendar.read"],
  list_ai_memories: ["aiMemory.read"],
  get_ai_memory: ["aiMemory.read"],
  match_ai_memory: ["aiMemory.read"],
  create_ai_memory_draft: ["aiMemory.create"],
  confirm_ai_memory_create: ["aiMemory.create"],
  update_ai_memory_draft: ["aiMemory.update"],
  confirm_ai_memory_update: ["aiMemory.update"],
  disable_ai_memory_draft: ["aiMemory.disable"],
  confirm_ai_memory_disable: ["aiMemory.disable"],
  restore_ai_memory_draft: ["aiMemory.update"],
  confirm_ai_memory_restore: ["aiMemory.update"],
};

function moduleAllowsCapability(
  settings: AiSecretarySettingsDoc,
  cap: SecretaryCapability
): boolean {
  const m = settings.modules;
  if (cap.startsWith("calendar.")) return m.calendar.enabled;
  if (cap.startsWith("tasks.")) return m.tasks.enabled;
  if (cap.startsWith("email.")) return m.email.enabled;
  if (cap.startsWith("jobs.")) return m.jobs.enabled;
  if (cap.startsWith("customers.")) return m.customers.enabled;
  if (cap.startsWith("aiMemory.")) return m.aiMemory.enabled;
  return false;
}

function granularAllows(
  settings: AiSecretarySettingsDoc,
  cap: SecretaryCapability
): boolean {
  const m = settings.modules;
  if (cap === "calendar.read") return m.calendar.read;
  if (cap === "calendar.create") return m.calendar.create;
  if (cap === "calendar.update") return m.calendar.update;
  if (cap === "calendar.delete") return m.calendar.delete;
  if (cap === "tasks.read") return m.tasks.read;
  if (cap === "tasks.create") return m.tasks.create;
  if (cap === "tasks.update") return m.tasks.update;
  if (cap === "tasks.delete") return m.tasks.delete;
  if (cap === "email.read") return m.email.read;
  if (cap === "email.draft") return m.email.draft;
  if (cap === "email.send") return m.email.send;
  if (cap === "jobs.read") return m.jobs.read;
  if (cap === "jobs.open") return m.jobs.open;
  if (cap === "jobs.write") return m.jobs.write;
  if (cap === "customers.read") return m.customers.read;
  if (cap === "aiMemory.read") return m.aiMemory.read;
  if (cap === "aiMemory.create") return m.aiMemory.create;
  if (cap === "aiMemory.update") return m.aiMemory.update;
  if (cap === "aiMemory.disable") return m.aiMemory.disable;
  return true;
}

function rbacAllows(cap: SecretaryCapability, perms: SecretaryPermissions): boolean {
  switch (cap) {
    case "calendar.read":
      return perms.canReadCalendar;
    case "calendar.create":
    case "calendar.update":
      return perms.canWriteCalendarMeetings;
    case "calendar.delete":
      return perms.canWriteCalendarMeetings;
    case "tasks.read":
      return perms.canReadJobs || perms.canWriteTasks;
    case "tasks.create":
    case "tasks.update":
      return perms.canWriteTasks;
    case "tasks.delete":
      return perms.canWriteTasks;
    case "email.read":
      return perms.canReadEmail;
    case "email.draft":
    case "email.send":
      return perms.canWriteEmail;
    case "jobs.read":
    case "jobs.open":
      return perms.canReadJobs;
    case "jobs.write":
      return perms.canWriteJobs;
    case "customers.read":
      return perms.canReadCustomers;
    case "aiMemory.read":
    case "aiMemory.create":
    case "aiMemory.update":
    case "aiMemory.disable":
      return true;
    default:
      return false;
  }
}

export function capabilityAllowed(
  settings: AiSecretarySettingsDoc,
  perms: SecretaryPermissions,
  cap: SecretaryCapability
): boolean {
  if (!settings.enabled) return false;
  if (!moduleAllowsCapability(settings, cap)) return false;
  if (!granularAllows(settings, cap)) return false;
  if (!rbacAllows(cap, perms)) return false;
  return true;
}

export function toolAllowed(
  settings: AiSecretarySettingsDoc,
  perms: SecretaryPermissions,
  toolName: string
): boolean {
  const caps = TOOL_REQUIRED_CAPABILITIES[toolName];
  if (!caps?.length) return false;
  return caps.every((c) => capabilityAllowed(settings, perms, c));
}

export async function resolveSecretaryAccess(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  companyId: string
): Promise<{ settings: AiSecretarySettingsDoc; perms: SecretaryPermissions }> {
  const [settings, perms] = await Promise.all([
    loadAiSecretarySettings(db, companyId),
    resolveSecretaryPermissions(db, caller, companyId),
  ]);
  return { settings: settings ?? defaultAiSecretarySettings(), perms };
}

export function assertSecretaryToolAccess(
  settings: AiSecretarySettingsDoc,
  perms: SecretaryPermissions,
  toolName: string
): { ok: true } | { ok: false; message: string } {
  if (!settings.enabled) {
    return { ok: false, message: "AI sekretářka je pro organizaci vypnutá." };
  }
  const caps = TOOL_REQUIRED_CAPABILITIES[toolName];
  if (!caps?.length) {
    return { ok: false, message: "Tento nástroj není povolen." };
  }
  for (const cap of caps) {
    if (!moduleAllowsCapability(settings, cap)) {
      return { ok: false, message: "Modul pro tento požadavek je v nastavení vypnutý." };
    }
    if (!granularAllows(settings, cap)) {
      return { ok: false, message: "Tato funkce sekretářky je v nastavení vypnutá." };
    }
    if (!rbacAllows(cap, perms)) {
      return { ok: false, message: "Nemáte oprávnění k této akci." };
    }
  }
  return { ok: true };
}
