import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
import { buildSecretaryContext } from "@/lib/ai/secretary/context";
import {
  assertSecretaryPermission,
  resolveSecretaryPermissions,
} from "@/lib/ai/secretary/permissions";
import { logSecretaryAudit } from "@/lib/ai/secretary/audit";
import {
  cancelPendingActionTool,
  confirmCalendarMeetingTool,
  createCalendarMeetingDraftTool,
  getCalendarEventsTool,
  proposeCancelCalendarMeetingTool,
  proposeUpdateCalendarMeetingTool,
  searchCalendarMeetingsTool,
  updateCalendarMeetingDraftTool,
} from "@/lib/ai/secretary/tools/calendar";
import {
  confirmEmployeeTaskTool,
  createEmployeeTaskDraftTool,
  proposeCancelTaskTool,
  proposeUpdateTaskTool,
  searchEmployeesTool,
  searchTasksTool,
  updateEmployeeTaskDraftTool,
} from "@/lib/ai/secretary/tools/tasks";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export type SecretaryToolName =
  | "get_calendar_events"
  | "getCalendarEvents"
  | "create_calendar_meeting"
  | "create_calendar_meeting_draft"
  | "proposeCreateCalendarEvent"
  | "update_calendar_meeting_draft"
  | "confirm_calendar_meeting"
  | "confirmPendingAction"
  | "cancel_pending_action"
  | "search_customers"
  | "searchCustomers"
  | "search_jobs"
  | "searchJobs"
  | "getTodayOverview"
  | "search_employees"
  | "create_employee_task_draft"
  | "update_employee_task_draft"
  | "confirm_employee_task"
  | "search_calendar_meetings"
  | "confirm_calendar_meeting_update"
  | "confirm_calendar_meeting_cancel"
  | "cancel_calendar_meeting_draft"
  | "search_tasks"
  | "update_task_draft"
  | "confirm_task_update"
  | "cancel_task_draft"
  | "confirm_task_cancel";

function normalizeToolName(name: string): SecretaryToolName | null {
  const map: Record<string, SecretaryToolName> = {
    get_calendar_events: "get_calendar_events",
    getCalendarEvents: "get_calendar_events",
    create_calendar_meeting: "create_calendar_meeting",
    create_calendar_meeting_draft: "create_calendar_meeting_draft",
    proposeCreateCalendarEvent: "create_calendar_meeting_draft",
    update_calendar_meeting_draft: "update_calendar_meeting_draft",
    confirm_calendar_meeting: "confirm_calendar_meeting",
    confirmPendingAction: "confirm_calendar_meeting",
    cancel_pending_action: "cancel_pending_action",
    search_customers: "search_customers",
    searchCustomers: "search_customers",
    search_jobs: "search_jobs",
    searchJobs: "search_jobs",
    getTodayOverview: "getTodayOverview",
    search_employees: "search_employees",
    create_employee_task_draft: "create_employee_task_draft",
    update_employee_task_draft: "update_employee_task_draft",
    confirm_employee_task: "confirm_employee_task",
    search_calendar_meetings: "search_calendar_meetings",
    confirm_calendar_meeting_update: "confirm_calendar_meeting_update",
    confirm_calendar_meeting_cancel: "confirm_calendar_meeting_cancel",
    cancel_calendar_meeting_draft: "cancel_calendar_meeting_draft",
    search_tasks: "search_tasks",
    update_task_draft: "update_task_draft",
    confirm_task_update: "confirm_task_update",
    cancel_task_draft: "cancel_task_draft",
    confirm_task_cancel: "confirm_task_cancel",
  };
  return map[name] ?? null;
}

export async function runSecretaryTool(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  companyId: string,
  toolNameRaw: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const toolName = normalizeToolName(toolNameRaw);
  if (!toolName) return { ok: false, error: "Neznámý nástroj." };

  const ctx = await buildSecretaryContext(db, caller, companyId);
  const perms = await resolveSecretaryPermissions(db, caller, companyId);

  try {
    switch (toolName) {
      case "get_calendar_events": {
        const gate = assertSecretaryPermission(perms, "calendar_read");
        if (!gate.ok) return { ok: false, error: gate.message };
        const result = await getCalendarEventsTool(db, ctx, {
          fromIso: String(args.fromIso ?? ""),
          toIso: String(args.toIso ?? ""),
        });
        return { ok: true, ...result };
      }
      case "create_calendar_meeting": {
        const gate = assertSecretaryPermission(perms, "calendar_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        const pendingId = String(args.pendingActionId ?? args.pendingId ?? "").trim();
        if (pendingId) {
          await logSecretaryAudit(db, {
            companyId,
            userId: caller.uid,
            action: "ai_action_confirmed",
            toolName: toolNameRaw,
          });
          const result = await confirmCalendarMeetingTool(db, ctx, {
            pendingActionId: pendingId,
            userConfirmationText:
              args.userConfirmationText != null
                ? String(args.userConfirmationText)
                : "ano",
          });
          if (result.ok) {
            await logSecretaryAudit(db, {
              companyId,
              userId: caller.uid,
              action: "ai_action_executed",
              toolName: toolNameRaw,
              detail: result.eventId,
            });
          }
          return { ok: result.ok, message: result.message, eventId: result.eventId ?? null };
        }
        await logSecretaryAudit(db, {
          companyId,
          userId: caller.uid,
          action: "ai_action_proposed",
          toolName: toolNameRaw,
        });
        const draftResult = await createCalendarMeetingDraftTool(db, ctx, args);
        return { ok: true, ...draftResult, pendingId: draftResult.pendingActionId };
      }
      case "create_calendar_meeting_draft": {
        const gate = assertSecretaryPermission(perms, "calendar_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        await logSecretaryAudit(db, {
          companyId,
          userId: caller.uid,
          action: "ai_action_proposed",
          toolName: toolNameRaw,
        });
        const result = await createCalendarMeetingDraftTool(db, ctx, args);
        return { ok: true, ...result, pendingId: result.pendingActionId };
      }
      case "update_calendar_meeting_draft": {
        const gate = assertSecretaryPermission(perms, "calendar_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        const pendingId = String(args.pendingActionId ?? args.pendingId ?? "").trim();
        const eventId = String(args.eventId ?? args.meetingId ?? "").trim();
        if (!pendingId && eventId) {
          const result = await proposeUpdateCalendarMeetingTool(db, ctx, args);
          return { ok: true, ...result, pendingId: result.pendingActionId };
        }
        return await updateCalendarMeetingDraftTool(db, ctx, args);
      }
      case "cancel_calendar_meeting_draft": {
        const gate = assertSecretaryPermission(perms, "calendar_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        const result = await proposeCancelCalendarMeetingTool(db, ctx, args);
        return { ok: true, ...result, pendingId: result.pendingActionId };
      }
      case "search_calendar_meetings": {
        const gate = assertSecretaryPermission(perms, "calendar_read");
        if (!gate.ok) return { ok: false, error: gate.message };
        const result = await searchCalendarMeetingsTool(db, ctx, {
          query: String(args.query ?? ""),
          fromIso: args.fromIso != null ? String(args.fromIso) : undefined,
          toIso: args.toIso != null ? String(args.toIso) : undefined,
        });
        return { ok: true, ...result };
      }
      case "confirm_calendar_meeting_update":
      case "confirm_calendar_meeting_cancel": {
        const gate = assertSecretaryPermission(perms, "calendar_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        const result = await confirmCalendarMeetingTool(db, ctx, {
          pendingActionId: String(args.pendingActionId ?? args.pendingId ?? ""),
          userConfirmationText:
            args.userConfirmationText != null ? String(args.userConfirmationText) : undefined,
        });
        if (result.ok && result.eventId) {
          await logSecretaryAudit(db, {
            companyId,
            userId: caller.uid,
            action:
              toolName === "confirm_calendar_meeting_cancel"
                ? "meeting_cancelled_via_ai_voice"
                : "meeting_updated_via_ai_voice",
            toolName: toolNameRaw,
            detail: result.eventId,
          });
        }
        return { ok: result.ok, message: result.message, eventId: result.eventId ?? null };
      }
      case "confirm_calendar_meeting": {
        const gate = assertSecretaryPermission(perms, "calendar_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        await logSecretaryAudit(db, {
          companyId,
          userId: caller.uid,
          action: "ai_action_confirmed",
          toolName: toolNameRaw,
        });
        const result = await confirmCalendarMeetingTool(db, ctx, {
          pendingActionId: String(args.pendingActionId ?? args.pendingId ?? ""),
          userConfirmationText:
            args.userConfirmationText != null ? String(args.userConfirmationText) : undefined,
        });
        if (result.ok) {
          await logSecretaryAudit(db, {
            companyId,
            userId: caller.uid,
            action: "ai_action_executed",
            toolName: toolNameRaw,
            detail: result.eventId,
          });
        } else {
          await logSecretaryAudit(db, {
            companyId,
            userId: caller.uid,
            action: "ai_action_failed",
            toolName: toolNameRaw,
            detail: result.message,
          });
        }
        return { ok: result.ok, message: result.message, eventId: result.eventId ?? null };
      }
      case "cancel_pending_action": {
        return await cancelPendingActionTool(db, ctx, {
          pendingActionId: String(args.pendingActionId ?? args.pendingId ?? ""),
        });
      }
      case "search_customers": {
        const gate = assertSecretaryPermission(perms, "customers_read");
        if (!gate.ok) return { ok: false, error: gate.message };
        const q = String(args.query ?? "").trim().slice(0, 80);
        if (!q) return { ok: true, customers: [] };
        const snap = await db
          .collection(COMPANIES_COLLECTION)
          .doc(companyId)
          .collection("customers")
          .orderBy("name")
          .limit(20)
          .get();
        const customers = snap.docs
          .map((d) => ({ id: d.id, name: (d.data().name as string) ?? d.id }))
          .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 8);
        return { ok: true, customers };
      }
      case "search_jobs": {
        const gate = assertSecretaryPermission(perms, "jobs_read");
        if (!gate.ok) return { ok: false, error: gate.message };
        const q = String(args.query ?? "").trim().slice(0, 80);
        const snap = await db
          .collection(COMPANIES_COLLECTION)
          .doc(companyId)
          .collection("jobs")
          .limit(30)
          .get();
        const jobs = snap.docs
          .map((d) => ({
            id: d.id,
            name: String(d.data().name ?? d.data().title ?? d.id),
          }))
          .filter((j) => !q || j.name.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 8);
        return { ok: true, jobs };
      }
      case "search_employees": {
        const gate = assertSecretaryPermission(perms, "tasks_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        const result = await searchEmployeesTool(db, companyId, {
          query: String(args.query ?? ""),
        });
        return { ok: true, ...result };
      }
      case "create_employee_task_draft": {
        const gate = assertSecretaryPermission(perms, "tasks_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        const employeeId = String(args.employeeId ?? "").trim();
        if (employeeId) {
          const assignGate = assertSecretaryPermission(perms, "tasks_assign");
          if (!assignGate.ok) return { ok: false, error: assignGate.message };
        }
        await logSecretaryAudit(db, {
          companyId,
          userId: caller.uid,
          action: "ai_action_proposed",
          toolName: toolNameRaw,
        });
        const result = await createEmployeeTaskDraftTool(db, ctx, args);
        return { ok: true, ...result, pendingId: result.pendingActionId };
      }
      case "update_employee_task_draft":
      case "update_task_draft": {
        const gate = assertSecretaryPermission(perms, "tasks_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        const pendingId = String(args.pendingActionId ?? args.pendingId ?? "").trim();
        const taskId = String(args.taskId ?? args.entityId ?? "").trim();
        if (!pendingId && taskId) {
          const result = await proposeUpdateTaskTool(db, ctx, args);
          return { ok: true, ...result, pendingId: result.pendingActionId };
        }
        return await updateEmployeeTaskDraftTool(db, ctx, args);
      }
      case "cancel_task_draft": {
        const gate = assertSecretaryPermission(perms, "tasks_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        const result = await proposeCancelTaskTool(db, ctx, args);
        return { ok: true, ...result, pendingId: result.pendingActionId };
      }
      case "search_tasks": {
        const gate = assertSecretaryPermission(perms, "tasks_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        const result = await searchTasksTool(db, companyId, {
          query: String(args.query ?? ""),
          employeeId: args.employeeId != null ? String(args.employeeId) : undefined,
        });
        return { ok: true, ...result };
      }
      case "confirm_task_update":
      case "confirm_task_cancel": {
        const gate = assertSecretaryPermission(perms, "tasks_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        const result = await confirmEmployeeTaskTool(db, ctx, {
          pendingActionId: String(args.pendingActionId ?? args.pendingId ?? ""),
          userConfirmationText:
            args.userConfirmationText != null ? String(args.userConfirmationText) : undefined,
        });
        if (result.ok && result.taskId) {
          await logSecretaryAudit(db, {
            companyId,
            userId: caller.uid,
            action:
              toolName === "confirm_task_cancel"
                ? "task_cancelled_via_ai_voice"
                : "task_updated_via_ai_voice",
            toolName: toolNameRaw,
            detail: result.taskId,
          });
        }
        return { ok: result.ok, message: result.message, taskId: result.taskId ?? null };
      }
      case "confirm_employee_task": {
        const gate = assertSecretaryPermission(perms, "tasks_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        await logSecretaryAudit(db, {
          companyId,
          userId: caller.uid,
          action: "ai_action_confirmed",
          toolName: toolNameRaw,
        });
        const result = await confirmEmployeeTaskTool(db, ctx, {
          pendingActionId: String(args.pendingActionId ?? args.pendingId ?? ""),
          userConfirmationText:
            args.userConfirmationText != null ? String(args.userConfirmationText) : undefined,
        });
        if (result.ok && result.taskId) {
          await logSecretaryAudit(db, {
            companyId,
            userId: caller.uid,
            action: "task_created_via_ai_voice",
            toolName: toolNameRaw,
            detail: JSON.stringify({
              taskId: result.taskId,
              createdByUserId: caller.uid,
            }),
          });
          await logSecretaryAudit(db, {
            companyId,
            userId: caller.uid,
            action: "ai_action_executed",
            toolName: toolNameRaw,
            detail: result.taskId,
          });
        } else if (!result.ok) {
          await logSecretaryAudit(db, {
            companyId,
            userId: caller.uid,
            action: "ai_action_failed",
            toolName: toolNameRaw,
            detail: result.message,
          });
        }
        return { ok: result.ok, message: result.message, taskId: result.taskId ?? null };
      }
      case "getTodayOverview": {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(23, 59, 59, 999);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const cal = perms.canReadCalendar
          ? await getCalendarEventsTool(db, ctx, {
              fromIso: todayStart.toISOString(),
              toIso: tomorrow.toISOString(),
            })
          : { events: [] };
        return {
          ok: true,
          todayEvents: cal.events,
          userDisplayName: ctx.userDisplayName,
          timezone: ctx.timezone,
        };
      }
      default:
        return { ok: false, error: "Neznámý nástroj." };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Nástroj selhal.";
    return { ok: false, error: msg };
  }
}

export function secretaryRealtimeToolDefinitions(): Array<Record<string, unknown>> {
  return [
    {
      type: "function",
      name: "get_calendar_events",
      description: "Načte schůzky z organizačního kalendáře.",
      parameters: {
        type: "object",
        properties: { fromIso: { type: "string" }, toIso: { type: "string" } },
      },
    },
    {
      type: "function",
      name: "create_calendar_meeting",
      description:
        "Kalendář: bez pendingActionId připraví návrh schůzky; s pendingActionId a potvrzením uživatele schůzku uloží.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD v timezone organizace" },
          startTime: { type: "string", description: "HH:mm" },
          endTime: { type: "string" },
          customerName: { type: "string" },
          customerId: { type: "string" },
          leadId: { type: "string" },
          jobId: { type: "string" },
          address: { type: "string" },
          description: { type: "string" },
          participants: { type: "string" },
          pendingActionId: { type: "string" },
          userConfirmationText: { type: "string" },
        },
        required: ["title"],
      },
    },
    {
      type: "function",
      name: "create_calendar_meeting_draft",
      description: "Alias: připraví návrh schůzky (stejné jako create_calendar_meeting bez pendingActionId).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD v timezone organizace" },
          startTime: { type: "string", description: "HH:mm" },
          endTime: { type: "string" },
          place: { type: "string" },
          note: { type: "string" },
          customerName: { type: "string" },
          calendarEventType: { type: "string", enum: ["meeting", "installation"] },
        },
        required: ["title", "date", "startTime"],
      },
    },
    {
      type: "function",
      name: "update_calendar_meeting_draft",
      description: "Upraví existující návrh schůzky (např. změna času).",
      parameters: {
        type: "object",
        properties: {
          pendingActionId: { type: "string" },
          title: { type: "string" },
          date: { type: "string" },
          startTime: { type: "string" },
          endTime: { type: "string" },
          place: { type: "string" },
          note: { type: "string" },
        },
        required: ["pendingActionId"],
      },
    },
    {
      type: "function",
      name: "confirm_calendar_meeting",
      description: "Po slovním ano zapíše návrh do kalendáře.",
      parameters: {
        type: "object",
        properties: {
          pendingActionId: { type: "string" },
          userConfirmationText: { type: "string" },
        },
        required: ["pendingActionId", "userConfirmationText"],
      },
    },
    {
      type: "function",
      name: "cancel_pending_action",
      description: "Zruší pending návrh.",
      parameters: {
        type: "object",
        properties: { pendingActionId: { type: "string" } },
        required: ["pendingActionId"],
      },
    },
    {
      type: "function",
      name: "getTodayOverview",
      description: "Přehled dnešních událostí.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "search_customers",
      description: "Vyhledá zákazníky.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      type: "function",
      name: "search_jobs",
      description: "Vyhledá zakázky.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      type: "function",
      name: "search_employees",
      description: "Vyhledá zaměstnance podle jména nebo e-mailu.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      type: "function",
      name: "create_employee_task_draft",
      description: "Připraví návrh úkolu pro zaměstnance. Neukládá — vyžaduje confirm_employee_task.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          employeeName: { type: "string" },
          employeeId: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          dueTime: { type: "string" },
          priority: { type: "string", enum: ["low", "normal", "high"] },
          jobId: { type: "string" },
          jobName: { type: "string" },
          customerId: { type: "string" },
        },
        required: ["title"],
      },
    },
    {
      type: "function",
      name: "update_employee_task_draft",
      description: "Upraví pending návrh úkolu (např. jiný zaměstnanec).",
      parameters: {
        type: "object",
        properties: {
          pendingActionId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          employeeName: { type: "string" },
          employeeId: { type: "string" },
          dueDate: { type: "string" },
          priority: { type: "string", enum: ["low", "normal", "high"] },
          jobId: { type: "string" },
          jobName: { type: "string" },
        },
        required: ["pendingActionId"],
      },
    },
    {
      type: "function",
      name: "confirm_employee_task",
      description: "Po slovním ano uloží návrh úkolu do modulu Úkoly.",
      parameters: {
        type: "object",
        properties: {
          pendingActionId: { type: "string" },
          userConfirmationText: { type: "string" },
        },
        required: ["pendingActionId", "userConfirmationText"],
      },
    },
    {
      type: "function",
      name: "search_calendar_meetings",
      description: "Vyhledá schůzky v kalendáři podle textu a období.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          fromIso: { type: "string" },
          toIso: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "cancel_calendar_meeting_draft",
      description: "Připraví návrh zrušení schůzky (vyžaduje confirm_calendar_meeting_cancel).",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string" },
          title: { type: "string" },
          customerName: { type: "string" },
        },
        required: ["eventId"],
      },
    },
    {
      type: "function",
      name: "confirm_calendar_meeting_update",
      description: "Po ano provede změnu schůzky z pending návrhu.",
      parameters: {
        type: "object",
        properties: {
          pendingActionId: { type: "string" },
          userConfirmationText: { type: "string" },
        },
        required: ["pendingActionId", "userConfirmationText"],
      },
    },
    {
      type: "function",
      name: "confirm_calendar_meeting_cancel",
      description: "Po ano zruší schůzku z pending návrhu.",
      parameters: {
        type: "object",
        properties: {
          pendingActionId: { type: "string" },
          userConfirmationText: { type: "string" },
        },
        required: ["pendingActionId", "userConfirmationText"],
      },
    },
    {
      type: "function",
      name: "search_tasks",
      description: "Vyhledá otevřené úkoly podle textu nebo zaměstnance.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          employeeId: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "update_task_draft",
      description: "Připraví návrh nového úkolu nebo změny existujícího (s taskId).",
      parameters: {
        type: "object",
        properties: {
          pendingActionId: { type: "string" },
          taskId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          employeeId: { type: "string" },
          dueDate: { type: "string" },
          priority: { type: "string", enum: ["low", "normal", "high"] },
        },
      },
    },
    {
      type: "function",
      name: "cancel_task_draft",
      description: "Připraví návrh smazání úkolu.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          title: { type: "string" },
        },
        required: ["taskId"],
      },
    },
    {
      type: "function",
      name: "confirm_task_update",
      description: "Po ano provede změnu úkolu.",
      parameters: {
        type: "object",
        properties: {
          pendingActionId: { type: "string" },
          userConfirmationText: { type: "string" },
        },
        required: ["pendingActionId", "userConfirmationText"],
      },
    },
    {
      type: "function",
      name: "confirm_task_cancel",
      description: "Po ano smaže úkol.",
      parameters: {
        type: "object",
        properties: {
          pendingActionId: { type: "string" },
          userConfirmationText: { type: "string" },
        },
        required: ["pendingActionId", "userConfirmationText"],
      },
    },
  ];
}
