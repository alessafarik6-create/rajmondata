import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { SecretaryContext } from "@/lib/ai/secretary/context";
import {
  cancelPendingSecretaryAction,
  consumePendingSecretaryAction,
  loadPendingSecretaryAction,
  proposeSecretaryAction,
  updatePendingSecretaryAction,
  userUtteranceConfirmsAction,
} from "@/lib/ai/secretary/confirmation";
import {
  createOrganizationTask,
  deleteOrganizationTask,
  updateOrganizationTask,
  validateOrganizationTaskDraft,
  type OrganizationTaskDraft,
} from "@/lib/tasks/create-organization-task-server";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { JobTaskPriority } from "@/lib/job-task-types";

function priorityFromArgs(raw: unknown): JobTaskPriority {
  const p = String(raw ?? "medium").toLowerCase();
  if (p === "high" || p === "urgent") return "high";
  if (p === "low") return "low";
  if (p === "normal") return "medium";
  return p === "high" || p === "low" ? p : "medium";
}

function draftFromArgs(args: Record<string, unknown>): OrganizationTaskDraft {
  const assignedTo = args.employeeId != null ? String(args.employeeId) : null;
  return {
    title: String(args.title ?? "").trim(),
    description: args.description != null ? String(args.description) : null,
    assignedTo: assignedTo?.trim() || null,
    assignedMode: assignedTo ? "single" : "all",
    dueDate: args.dueDate != null ? String(args.dueDate).trim() : null,
    priority: priorityFromArgs(args.priority),
    jobId: args.jobId != null ? String(args.jobId) : null,
    jobName: args.jobName != null ? String(args.jobName) : null,
    employeeName: args.employeeName != null ? String(args.employeeName) : null,
  };
}

function formatTaskSummary(draft: OrganizationTaskDraft, ctx: SecretaryContext): string {
  const who =
    draft.employeeName?.trim() ||
    (draft.assignedTo ? `zaměstnanec ${draft.assignedTo}` : "všem");
  const due = draft.dueDate ? `, termín ${draft.dueDate}` : "";
  return `Úkol „${draft.title}“ pro ${who}${due}.`;
}

export async function searchEmployeesTool(
  db: Firestore,
  companyId: string,
  args: { query?: string }
): Promise<{ employees: Array<{ id: string; name: string; email?: string | null }> }> {
  const q = String(args.query ?? "").trim().toLowerCase();
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("employees")
    .limit(80)
    .get();

  const employees = snap.docs
    .map((d) => {
      const data = d.data();
      const name = `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim() || String(d.id);
      const email = data.email != null ? String(data.email) : null;
      return { id: d.id, name, email };
    })
    .filter((e) => {
      if (!q) return true;
      const hay = `${e.name} ${e.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 12);

  return { employees };
}

export async function searchTasksTool(
  db: Firestore,
  companyId: string,
  args: { query?: string; employeeId?: string }
): Promise<{ tasks: Array<Record<string, unknown>> }> {
  const q = String(args.query ?? "").trim().toLowerCase();
  const employeeId = String(args.employeeId ?? "").trim();
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("tasks")
    .limit(80)
    .get();

  const tasks = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: String(data.title ?? ""),
        description: String(data.description ?? ""),
        dueDate: data.dueDate ?? null,
        assignedTo: data.assignedTo ?? null,
        status: data.status ?? "open",
        priority: data.priority ?? "medium",
      };
    })
    .filter((t) => (t.status ?? "open") !== "done")
    .filter((t) => !employeeId || String(t.assignedTo) === employeeId)
    .filter((t) => !q || `${t.title} ${t.description}`.toLowerCase().includes(q))
    .slice(0, 12);

  return { tasks };
}

export async function proposeUpdateTaskTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: Record<string, unknown>
): Promise<{ pendingActionId: string; summary: string; requiresConfirmation: true }> {
  const taskId = String(args.taskId ?? args.entityId ?? "").trim();
  if (!taskId) throw new Error("Chybí taskId.");
  const draft = draftFromArgs(args);
  const v = validateOrganizationTaskDraft(draft);
  if (!v.ok) throw new Error(v.error);
  const summary = `Změna úkolu: ${formatTaskSummary(draft, ctx)}`;
  const { pendingId } = await proposeSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "update_task",
    payload: { taskId, entityId: taskId, draft },
    summary,
  });
  return { pendingActionId: pendingId, summary, requiresConfirmation: true };
}

export async function proposeCancelTaskTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: Record<string, unknown>
): Promise<{ pendingActionId: string; summary: string; requiresConfirmation: true }> {
  const taskId = String(args.taskId ?? args.entityId ?? "").trim();
  if (!taskId) throw new Error("Chybí taskId.");
  const title = String(args.title ?? "Úkol").trim();
  const summary = `Zrušení úkolu „${title}“.`;
  const { pendingId } = await proposeSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "cancel_task",
    payload: { taskId, entityId: taskId, title },
    summary,
  });
  return { pendingActionId: pendingId, summary, requiresConfirmation: true };
}

export async function createEmployeeTaskDraftTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: Record<string, unknown>
): Promise<{ pendingActionId: string; summary: string; requiresConfirmation: true }> {
  const draft = draftFromArgs(args);
  const v = validateOrganizationTaskDraft(draft);
  if (!v.ok) throw new Error(v.error);

  const summary = formatTaskSummary(draft, ctx);
  const { pendingId } = await proposeSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "create_employee_task",
    payload: { ...draft },
    summary,
  });
  return { pendingActionId: pendingId, summary, requiresConfirmation: true };
}

export async function updateEmployeeTaskDraftTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: Record<string, unknown>
): Promise<{ ok: boolean; pendingActionId?: string; summary?: string; message?: string }> {
  const pendingId = String(args.pendingActionId ?? args.pendingId ?? "").trim();
  if (!pendingId) return { ok: false, message: "Chybí pendingActionId." };
  const pending = await loadPendingSecretaryAction(db, ctx.companyId, pendingId, ctx.userId);
  if (!pending) return { ok: false, message: "Návrh neexistuje." };

  const basePayload =
    pending.type === "update_task"
      ? { ...(pending.payload as { draft?: Record<string, unknown> }).draft, ...args }
      : { ...pending.payload, ...args };
  const draft = draftFromArgs(basePayload as Record<string, unknown>);
  const v = validateOrganizationTaskDraft(draft);
  if (!v.ok) return { ok: false, message: v.error };

  const summary =
    pending.type === "update_task"
      ? `Změna úkolu: ${formatTaskSummary(draft, ctx)}`
      : formatTaskSummary(draft, ctx);
  const payloadPatch =
    pending.type === "update_task"
      ? {
          taskId: String((pending.payload as { taskId?: string }).taskId ?? ""),
          entityId: String((pending.payload as { taskId?: string }).taskId ?? ""),
          draft,
        }
      : (draft as unknown as Record<string, unknown>);
  await updatePendingSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    pendingId,
    payloadPatch,
    summary,
  });
  return { ok: true, pendingActionId: pendingId, summary };
}

export async function confirmEmployeeTaskTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { pendingActionId?: string; pendingId?: string; userConfirmationText?: string }
): Promise<{ ok: boolean; message: string; taskId?: string }> {
  const pendingId = String(args.pendingActionId ?? args.pendingId ?? "").trim();
  const pending = await loadPendingSecretaryAction(db, ctx.companyId, pendingId, ctx.userId);
  if (!pending) {
    return { ok: false, message: "Návrh akce vypršel nebo neexistuje." };
  }
  if (!userUtteranceConfirmsAction(args.userConfirmationText)) {
    return {
      ok: false,
      message: "Potvrzení nebylo rozpoznáno. Řekněte například „ano“.",
    };
  }

  if (pending.type === "create_employee_task") {
    const draft = pending.payload as unknown as OrganizationTaskDraft;
    const { taskId } = await createOrganizationTask(db, {
      companyId: ctx.companyId,
      draft,
      createdByUserId: ctx.userId,
      createdVia: "ai_voice",
    });

    await db
      .collection(COMPANIES_COLLECTION)
      .doc(ctx.companyId)
      .collection("aiSecretaryPending")
      .doc(pendingId)
      .set({ status: "confirmed", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await consumePendingSecretaryAction(db, ctx.companyId, pendingId);

    const who = draft.employeeName?.trim() || "zaměstnance";
    const due = draft.dueDate ? ` na ${draft.dueDate}` : "";
    return {
      ok: true,
      message: `Hotovo, úkol jsem vytvořila pro ${who}${due}.`,
      taskId,
    };
  }

  if (pending.type === "update_task") {
    const payload = pending.payload as { taskId?: string; draft?: OrganizationTaskDraft };
    const taskId = String(payload.taskId ?? "").trim();
    const draft = payload.draft as OrganizationTaskDraft;
    if (!taskId || !draft) return { ok: false, message: "Neplatný návrh změny úkolu." };
    await updateOrganizationTask(db, { companyId: ctx.companyId, taskId, draft });
    await consumePendingSecretaryAction(db, ctx.companyId, pendingId);
    return {
      ok: true,
      message: `Hotovo, úkol jsem upravila${draft.dueDate ? ` na termín ${draft.dueDate}` : ""}.`,
      taskId,
    };
  }

  if (pending.type === "cancel_task") {
    const payload = pending.payload as { taskId?: string };
    const taskId = String(payload.taskId ?? "").trim();
    if (!taskId) return { ok: false, message: "Neplatný návrh zrušení úkolu." };
    await deleteOrganizationTask(db, { companyId: ctx.companyId, taskId });
    await consumePendingSecretaryAction(db, ctx.companyId, pendingId);
    return { ok: true, message: "Hotovo, úkol jsem zrušila.", taskId };
  }

  return { ok: false, message: "Nepodporovaný typ akce." };
}

export const confirmTaskUpdateTool = confirmEmployeeTaskTool;
export const confirmTaskCancelTool = confirmEmployeeTaskTool;
