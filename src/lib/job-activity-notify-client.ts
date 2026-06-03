import type { JobActivityNotifyEvent } from "@/lib/email-notifications/job-activity-notify-server";

export type NotifyJobActivityParams = {
  idToken: string;
  companyId: string;
  jobId: string;
  eventType: JobActivityNotifyEvent;
  folderId?: string | null;
  folderName?: string | null;
  fileId?: string | null;
  fileName?: string | null;
  messagePreview?: string | null;
  batchFileNames?: string[];
  visibleToCustomer?: boolean | null;
  entityId?: string | null;
};

/** Fire-and-forget volání API pro e-mailové upozornění u zakázky. */
export async function notifyJobActivity(params: NotifyJobActivityParams): Promise<void> {
  try {
    await fetch("/api/jobs/activity-notify", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyId: params.companyId,
        jobId: params.jobId,
        eventType: params.eventType,
        folderId: params.folderId ?? null,
        folderName: params.folderName ?? null,
        fileId: params.fileId ?? null,
        fileName: params.fileName ?? null,
        messagePreview: params.messagePreview ?? null,
        batchFileNames: params.batchFileNames ?? null,
        visibleToCustomer: params.visibleToCustomer ?? null,
        entityId: params.entityId ?? null,
      }),
    });
  } catch {
    // neblokovat UI
  }
}
