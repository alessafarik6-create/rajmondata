import { doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore";
import type { DashboardTaskItem } from "@/lib/dashboard-task-items-merge";
import { itemForAll } from "@/lib/dashboard-task-items-merge";
import type { JobTaskStatus } from "@/lib/job-task-types";
import type { OrganizationTask, OrganizationTaskStatus } from "@/lib/organization-task";
import { organizationTaskIsForAll } from "@/lib/organization-task";
import { setOrganizationTaskCompletionForUser } from "@/lib/tasks/organization-task-completion";

/** Označí dashboard úkol jako hotový (Firestore — realtime pro všechny widgety). */
export async function markDashboardTaskDone(
  firestore: Firestore,
  companyId: string,
  item: DashboardTaskItem,
  viewer?: { userId: string; employeeId?: string | null; canManageAllTasks?: boolean }
): Promise<void> {
  const cid = String(companyId).trim();
  if (!cid) throw new Error("Chybí companyId");

  if (item.source === "job") {
    const jid = item.jobId?.trim();
    if (!jid) throw new Error("Chybí zakázka u úkolu");
    await updateDoc(
      doc(firestore, "companies", cid, "jobs", jid, "tasks", item.taskId),
      {
        status: "done" as JobTaskStatus,
        updatedAt: serverTimestamp(),
      }
    );
    return;
  }

  const perUser =
    itemForAll(item) ||
    item.assignedMode === "multi" ||
    organizationTaskIsForAll({
      assignedMode: item.assignedMode,
      assignedTo: item.assignedTo,
    } as OrganizationTask);

  if (perUser && viewer?.userId) {
    await setOrganizationTaskCompletionForUser(
      firestore,
      cid,
      {
        id: item.taskId,
        title: item.title,
        status: item.orgStatus ?? "open",
        assignedTo: item.assignedTo,
        assignedMode: item.assignedMode,
        assignedTargets: item.assignedTargets,
        completedByUserIds: item.completedByUserIds,
        organizationId: cid,
        createdBy: item.createdBy ?? "",
      },
      {
        userId: viewer.userId,
        employeeId: viewer.employeeId,
        canManageAllTasks: viewer.canManageAllTasks,
      },
      true
    );
    return;
  }

  await updateDoc(doc(firestore, "companies", cid, "tasks", item.taskId), {
    status: "done" as OrganizationTaskStatus,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
