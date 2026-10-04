import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { JobTaskPriority } from "@/lib/job-task-types";

export type OrganizationTaskDraft = {
  title: string;
  description?: string | null;
  assignedTo?: string | null;
  assignedMode?: "single" | "all";
  dueDate?: string | null;
  priority?: JobTaskPriority;
  jobId?: string | null;
  jobName?: string | null;
  employeeName?: string | null;
};

function normalizePriority(raw: unknown): JobTaskPriority {
  const p = String(raw ?? "medium").toLowerCase();
  if (p === "high" || p === "urgent") return "high";
  if (p === "low") return "low";
  if (p === "normal") return "medium";
  return p === "high" || p === "low" ? p : "medium";
}

export function validateOrganizationTaskDraft(
  draft: OrganizationTaskDraft
): { ok: true } | { ok: false; error: string } {
  const title = String(draft.title ?? "").trim();
  if (!title) return { ok: false, error: "Chybí název úkolu." };
  if (draft.assignedMode === "single" && !String(draft.assignedTo ?? "").trim()) {
    return { ok: false, error: "Chybí zaměstnanec pro přiřazení." };
  }
  const due = String(draft.dueDate ?? "").trim();
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return { ok: false, error: "Neplatný termín (YYYY-MM-DD)." };
  }
  return { ok: true };
}

/** Stejná pole jako UI „Nový úkol“ v organization-tasks-dialog. */
export async function createOrganizationTask(
  db: Firestore,
  input: {
    companyId: string;
    draft: OrganizationTaskDraft;
    createdByUserId: string;
    createdVia?: string;
  }
): Promise<{ taskId: string }> {
  const v = validateOrganizationTaskDraft(input.draft);
  if (!v.ok) throw new Error(v.error);

  const assignedMode = input.draft.assignedMode ?? (input.draft.assignedTo ? "single" : "all");
  const assignedTo =
    assignedMode === "all" ? null : String(input.draft.assignedTo ?? "").trim() || null;

  let description = String(input.draft.description ?? "").trim();
  const jobName = String(input.draft.jobName ?? "").trim();
  const jobId = String(input.draft.jobId ?? "").trim();
  if (jobId && jobName && !description.includes(jobName)) {
    description = description
      ? `${description}\nZakázka: ${jobName}`
      : `Zakázka: ${jobName}`;
  }

  const duePayload =
    input.draft.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(input.draft.dueDate))
      ? String(input.draft.dueDate)
      : null;

  const ref = await db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection("tasks")
    .add({
      title: String(input.draft.title).trim(),
      description: description || null,
      dueDate: duePayload,
      priority: normalizePriority(input.draft.priority),
      organizationId: input.companyId,
      status: "open",
      assignedMode,
      assignedTo,
      createdBy: input.createdByUserId,
      createdVia: input.createdVia ?? "ai_voice",
      jobId: jobId || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: null,
    });

  return { taskId: ref.id };
}
