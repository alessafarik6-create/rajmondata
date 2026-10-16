import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { JobTaskPriority } from "@/lib/job-task-types";

export type OrganizationTaskDraft = {
  title: string;
  description?: string | null;
  assignedTo?: string | null;
  assignedMode?: "single" | "all" | "multi";
  assignedTargets?: string[] | null;
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
  const mode = draft.assignedMode ?? (draft.assignedTo ? "single" : "all");
  if (mode === "single" && !String(draft.assignedTo ?? "").trim()) {
    return { ok: false, error: "Chybí osoba pro přiřazení." };
  }
  if (mode === "multi") {
    const targets = (draft as { assignedTargets?: string[] }).assignedTargets;
    if (!Array.isArray(targets) || targets.filter((t) => String(t).trim()).length === 0) {
      return { ok: false, error: "Vyberte alespoň jednu osobu." };
    }
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
    assignedMode === "all" || assignedMode === "multi"
      ? null
      : String(input.draft.assignedTo ?? "").trim() || null;
  const assignedTargets =
    assignedMode === "multi"
      ? (input.draft.assignedTargets ?? [])
          .map((t) => String(t).trim())
          .filter(Boolean)
      : [];

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
      assignedTargets: assignedTargets?.length ? assignedTargets : null,
      completedByUserIds: [],
      createdBy: input.createdByUserId,
      createdVia: input.createdVia ?? "ai_voice",
      jobId: jobId || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: null,
    });

  return { taskId: ref.id };
}

export async function updateOrganizationTask(
  db: Firestore,
  input: {
    companyId: string;
    taskId: string;
    draft: OrganizationTaskDraft;
  }
): Promise<void> {
  const v = validateOrganizationTaskDraft(input.draft);
  if (!v.ok) throw new Error(v.error);

  const ref = db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection("tasks")
    .doc(input.taskId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Úkol neexistuje.");

  const assignedMode = input.draft.assignedMode ?? (input.draft.assignedTo ? "single" : "all");
  const assignedTo =
    assignedMode === "all" || assignedMode === "multi"
      ? null
      : String(input.draft.assignedTo ?? "").trim() || null;
  const assignedTargets =
    assignedMode === "multi"
      ? (input.draft.assignedTargets ?? [])
          .map((t) => String(t).trim())
          .filter(Boolean)
      : [];

  await ref.update({
    title: String(input.draft.title).trim(),
    description: String(input.draft.description ?? "").trim() || null,
    dueDate:
      input.draft.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(input.draft.dueDate))
        ? String(input.draft.dueDate)
        : null,
    priority: normalizePriority(input.draft.priority),
    assignedMode,
    assignedTo,
    assignedTargets: assignedMode === "multi" ? assignedTargets : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteOrganizationTask(
  db: Firestore,
  input: { companyId: string; taskId: string }
): Promise<void> {
  const ref = db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection("tasks")
    .doc(input.taskId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Úkol neexistuje.");
  await ref.delete();
}
