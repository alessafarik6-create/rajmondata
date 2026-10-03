import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
import { buildSecretaryContext } from "@/lib/ai/secretary/context";
import {
  assertSecretaryPermission,
  resolveSecretaryPermissions,
  type SecretaryPermissions,
} from "@/lib/ai/secretary/permissions";
import { logSecretaryAudit } from "@/lib/ai/secretary/audit";
import {
  confirmPendingCalendarActionTool,
  getCalendarEventsTool,
  proposeCreateCalendarEventTool,
} from "@/lib/ai/secretary/tools/calendar";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export type SecretaryToolName =
  | "getCalendarEvents"
  | "proposeCreateCalendarEvent"
  | "confirmPendingAction"
  | "searchCustomers"
  | "searchJobs"
  | "getTodayOverview";

export async function runSecretaryTool(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  companyId: string,
  toolName: SecretaryToolName,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const ctx = await buildSecretaryContext(db, caller, companyId);
  const perms = await resolveSecretaryPermissions(db, caller, companyId);

  const needConfirm = (
    name: SecretaryToolName
  ): name is "proposeCreateCalendarEvent" | "confirmPendingAction" => {
    return name === "proposeCreateCalendarEvent" || name === "confirmPendingAction";
  };

  try {
    switch (toolName) {
      case "getCalendarEvents": {
        const gate = assertSecretaryPermission(perms, "calendar_read");
        if (!gate.ok) return { ok: false, error: gate.message };
        const result = await getCalendarEventsTool(db, ctx, {
          fromIso: String(args.fromIso ?? ""),
          toIso: String(args.toIso ?? ""),
        });
        return { ok: true, ...result };
      }
      case "proposeCreateCalendarEvent": {
        const gate = assertSecretaryPermission(perms, "calendar_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        await logSecretaryAudit(db, {
          companyId,
          userId: caller.uid,
          action: "ai_action_proposed",
          toolName,
        });
        const result = await proposeCreateCalendarEventTool(db, ctx, perms, {
          title: String(args.title ?? ""),
          scheduledAtIso: String(args.scheduledAtIso ?? ""),
          place: args.place != null ? String(args.place) : undefined,
          note: args.note != null ? String(args.note) : undefined,
          calendarEventType:
            args.calendarEventType != null ? String(args.calendarEventType) : undefined,
        });
        return { ok: true, ...result };
      }
      case "confirmPendingAction": {
        const gate = assertSecretaryPermission(perms, "calendar_write");
        if (!gate.ok) return { ok: false, error: gate.message };
        await logSecretaryAudit(db, {
          companyId,
          userId: caller.uid,
          action: "ai_action_confirmed",
          toolName,
        });
        const result = await confirmPendingCalendarActionTool(db, ctx, {
          pendingId: String(args.pendingId ?? ""),
          userConfirmationText:
            args.userConfirmationText != null ? String(args.userConfirmationText) : undefined,
        });
        if (result.ok) {
          await logSecretaryAudit(db, {
            companyId,
            userId: caller.uid,
            action: "ai_action_executed",
            toolName,
            detail: result.eventId,
          });
        } else {
          await logSecretaryAudit(db, {
            companyId,
            userId: caller.uid,
            action: "ai_action_failed",
            toolName,
            detail: result.message,
          });
        }
        return { ok: result.ok, message: result.message, eventId: result.eventId ?? null };
      }
      case "searchCustomers": {
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
      case "searchJobs": {
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
      case "getTodayOverview": {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(23, 59, 59, 999);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const cal =
          perms.canReadCalendar
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
    if (needConfirm(toolName)) {
      await logSecretaryAudit(db, {
        companyId,
        userId: caller.uid,
        action: "ai_action_failed",
        toolName,
        detail: msg,
      });
    }
    return { ok: false, error: msg };
  }
}

export function secretaryRealtimeToolDefinitions(): Array<Record<string, unknown>> {
  return [
    {
      type: "function",
      name: "getCalendarEvents",
      description: "Načte schůzky a montáže z organizačního kalendáře v intervalu.",
      parameters: {
        type: "object",
        properties: {
          fromIso: { type: "string" },
          toIso: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "proposeCreateCalendarEvent",
      description:
        "Připraví návrh nové schůzky v kalendáři. Nevytváří ji — vyžaduje confirmPendingAction.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          scheduledAtIso: { type: "string", description: "ISO 8601 v timezone organizace" },
          place: { type: "string" },
          note: { type: "string" },
          calendarEventType: { type: "string", enum: ["meeting", "installation"] },
        },
        required: ["title", "scheduledAtIso"],
      },
    },
    {
      type: "function",
      name: "confirmPendingAction",
      description:
        "Provede dříve navrženou akci po explicitním slovním potvrzení uživatele.",
      parameters: {
        type: "object",
        properties: {
          pendingId: { type: "string" },
          userConfirmationText: { type: "string" },
        },
        required: ["pendingId", "userConfirmationText"],
      },
    },
    {
      type: "function",
      name: "getTodayOverview",
      description: "Přehled dnešních událostí a kontext uživatele.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "searchCustomers",
      description: "Vyhledá zákazníky podle jména.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      type: "function",
      name: "searchJobs",
      description: "Vyhledá zakázky podle názvu.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  ];
}
