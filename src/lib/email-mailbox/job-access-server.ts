import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { formatJobPickerLabel } from "@/lib/email-mailbox/job-picker-label";

export async function assertJobBelongsToCompany(
  db: Firestore,
  companyId: string,
  jobId: string
): Promise<
  | { ok: true; jobId: string; jobNumber: string; jobName: string; jobLabel: string }
  | { ok: false; error: string; status: number }
> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .doc(jobId)
    .get();

  if (!snap.exists) {
    return { ok: false, error: "Zakázka neexistuje.", status: 404 };
  }

  const data = snap.data() as Record<string, unknown>;
  const org = String(data.organizationId ?? data.companyId ?? "").trim();
  if (org && org !== companyId) {
    return { ok: false, error: "Zakázka nepatří do této organizace.", status: 403 };
  }

  const orderNumber = String(data.orderNumber ?? data.jobNumber ?? "").trim();
  const title = String(data.title ?? data.name ?? "").trim();
  const customerName = String(data.customerName ?? data.clientName ?? "").trim();
  const jobLabel = formatJobPickerLabel({ orderNumber, title, customerName, id: jobId });
  const jobName = title || customerName || jobId;

  return {
    ok: true,
    jobId,
    jobNumber: orderNumber,
    jobName,
    jobLabel,
  };
}
