import { doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore";
import type { DashboardTaskItem } from "@/lib/dashboard-task-items-merge";
import type { JobTaskStatus } from "@/lib/job-task-types";
import type { OrganizationTaskStatus } from "@/lib/organization-task";

/** Označí dashboard úkol jako hotový (Firestore — realtime pro všechny widgety). */
export async function markDashboardTaskDone(
  firestore: Firestore,
  companyId: string,
  item: DashboardTaskItem
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

  await updateDoc(doc(firestore, "companies", cid, "tasks", item.taskId), {
    status: "done" as OrganizationTaskStatus,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
