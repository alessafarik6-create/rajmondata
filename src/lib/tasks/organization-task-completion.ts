import {
  arrayRemove,
  arrayUnion,
  serverTimestamp,
  updateDoc,
  type Firestore,
  doc,
} from "firebase/firestore";
import type { OrganizationTask } from "@/lib/organization-task";
import { isTaskOpen, organizationTaskIsForAll } from "@/lib/organization-task";
import {
  organizationTaskUserCanToggleCompletion,
  type OrganizationTaskViewerContext,
} from "@/lib/tasks/organization-task-visibility";

export async function setOrganizationTaskCompletionForUser(
  firestore: Firestore,
  companyId: string,
  task: OrganizationTask,
  ctx: OrganizationTaskViewerContext,
  markDone: boolean
): Promise<void> {
  if (!organizationTaskUserCanToggleCompletion(task, ctx)) {
    throw new Error("Nemáte oprávnění měnit tento úkol.");
  }
  const ref = doc(firestore, "companies", companyId, "tasks", task.id);
  const uid = String(ctx.userId ?? "").trim();
  const perUser = organizationTaskIsForAll(task) || task.assignedMode === "multi";

  if (perUser) {
    await updateDoc(ref, {
      completedByUserIds: markDone ? arrayUnion(uid) : arrayRemove(uid),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const next = markDone ? "done" : "open";
  await updateDoc(ref, {
    status: next,
    completedAt: markDone ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}

export function organizationTaskDoneForViewer(
  task: OrganizationTask,
  ctx: OrganizationTaskViewerContext
): boolean {
  const perUser = organizationTaskIsForAll(task) || task.assignedMode === "multi";
  if (perUser) {
    const list = Array.isArray(task.completedByUserIds) ? task.completedByUserIds : [];
    return list.map(String).includes(String(ctx.userId));
  }
  return !isTaskOpen(task);
}
