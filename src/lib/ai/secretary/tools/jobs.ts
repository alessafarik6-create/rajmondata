import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  jobSearchHaystackFromJobData,
  mapFirestoreJobToPickerRow,
} from "@/lib/email-mailbox/job-picker-label";
import { calculateJobPaymentSummary } from "@/lib/job-payment-summary";
import { jobStatusLabel } from "@/lib/job-status";

const SEARCH_LIMIT = 10;

export type JobSearchHit = {
  id: string;
  label: string;
  orderNumber: string;
  title: string;
  customerName: string;
  address: string;
  status: string;
};

function jobStatusFromData(data: Record<string, unknown>): string {
  return String(data.status ?? "").trim();
}

export async function secretarySearchJobsTool(
  db: Firestore,
  companyId: string,
  args: {
    query?: string;
    status?: string;
    customer?: string;
    limit?: number;
  }
): Promise<{ jobs: JobSearchHit[]; hint?: string }> {
  const q = String(args.query ?? "").trim().toLowerCase();
  const customer = String(args.customer ?? "").trim().toLowerCase();
  const statusFilter = String(args.status ?? "").trim().toLowerCase();
  const limit = Math.min(SEARCH_LIMIT, Math.max(1, Number(args.limit) || SEARCH_LIMIT));

  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .limit(120)
    .get();

  let rows = snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const org = String(data.organizationId ?? data.companyId ?? "").trim();
      if (org && org !== companyId) return null;
      const picker = mapFirestoreJobToPickerRow(d.id, data);
      const hay = jobSearchHaystackFromJobData(d.id, data);
      const status = jobStatusFromData(data);
      return { ...picker, hay, status };
    })
    .filter(Boolean) as (ReturnType<typeof mapFirestoreJobToPickerRow> & {
    hay: string;
    status: string;
  })[];

  rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  if (q) rows = rows.filter((r) => r.hay.includes(q));
  if (customer) rows = rows.filter((r) => r.customerName.toLowerCase().includes(customer));
  if (statusFilter) rows = rows.filter((r) => r.status.toLowerCase().includes(statusFilter));

  const jobs = rows.slice(0, limit).map((r) => ({
    id: r.id,
    label: r.label,
    orderNumber: r.orderNumber,
    title: r.title,
    customerName: r.customerName,
    address: r.address,
    status: r.status ? jobStatusLabel(r.status) : "—",
  }));

  const hint =
    jobs.length > 1
      ? "Nalezeno více zakázek — zeptej se uživatele, kterou myslí (nepředpokládej první)."
      : undefined;

  return { jobs, hint };
}

export async function secretaryGetJobDetailTool(
  db: Firestore,
  companyId: string,
  jobId: string
): Promise<Record<string, unknown>> {
  const ref = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("jobs").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "Zakázka nebyla nalezena." };
  const data = snap.data() as Record<string, unknown>;

  const picker = mapFirestoreJobToPickerRow(snap.id, data);
  const statusRaw = jobStatusFromData(data);
  const notes = String(data.notes ?? data.internalNote ?? "").trim().slice(0, 800) || null;
  const responsible = String(
    data.responsibleName ?? data.assignedToName ?? data.managerName ?? ""
  ).trim() || null;
  const deadline =
    String(data.deadline ?? data.deadlineDate ?? data.dueDate ?? "").trim().slice(0, 10) || null;
  const installation =
    String(
      data.installationDate ??
        data.plannedInstallationDate ??
        data.montageDate ??
        ""
    ).trim().slice(0, 10) || null;

  const [invSnap, wcSnap, incomeSnap, taskSnap, logSnap] = await Promise.all([
    ref.collection("invoices").limit(8).get().catch(() => null),
    db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("work_contracts")
      .where("jobId", "==", jobId)
      .limit(4)
      .get()
      .catch(() => null),
    ref.collection("job_incomes").limit(12).get().catch(() => null),
    db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("tasks")
      .where("jobId", "==", jobId)
      .limit(6)
      .get()
      .catch(() => null),
    db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("activityLogs")
      .where("entityId", "==", jobId)
      .limit(3)
      .get()
      .catch(() => null),
  ]);

  const invoices = (invSnap?.docs ?? []).map((d) => {
    const i = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      number: String(i.invoiceNumber ?? i.documentNumber ?? d.id),
      type: String(i.type ?? ""),
      status: String(i.status ?? i.paymentStatus ?? ""),
    };
  });

  const payment = calculateJobPaymentSummary({
    job: data,
    invoices: (invSnap?.docs ?? []).map((d) => ({ id: d.id, ...(d.data() as object) })),
    workContracts: (wcSnap?.docs ?? []).map((d) => ({
      id: d.id,
      ...(d.data() as Record<string, unknown>),
    })) as Parameters<typeof calculateJobPaymentSummary>[0]["workContracts"],
    jobIncomes: (incomeSnap?.docs ?? []).map((d) => ({
      id: d.id,
      ...(d.data() as Record<string, unknown>),
    })) as Parameters<typeof calculateJobPaymentSummary>[0]["jobIncomes"],
  });

  const tasks = (taskSnap?.docs ?? []).map((d) => {
    const t = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      title: String(t.title ?? "").slice(0, 120),
      status: String(t.status ?? ""),
      dueDate: String(t.dueDate ?? "").slice(0, 10) || null,
    };
  });

  const recentActivity = (logSnap?.docs ?? []).map((d) => {
    const a = d.data() as Record<string, unknown>;
    return String(a.actionLabel ?? a.actionType ?? "událost").slice(0, 120);
  });

  return {
    ok: true,
    job: {
      id: snap.id,
      label: picker.label,
      orderNumber: picker.orderNumber,
      title: picker.title,
      customerName: picker.customerName,
      address: picker.address,
      status: statusRaw ? jobStatusLabel(statusRaw) : null,
      deadline,
      installationDate: installation,
      responsiblePerson: responsible,
      notes,
      payment: {
        totalPriceGross: payment.totalPriceGross,
        totalPaidGross: payment.totalPaidGross,
        remainingToPayGross: payment.remainingToPayGross,
        jobPaymentStatus: payment.jobPaymentStatus,
      },
      invoices,
      openTasks: tasks,
      recentActivity,
    },
  };
}

export async function secretaryGetRecentJobsTool(
  db: Firestore,
  companyId: string,
  args: { overdueOnly?: boolean; limit?: number }
): Promise<{ jobs: JobSearchHit[] }> {
  const limit = Math.min(10, Math.max(1, Number(args.limit) || 8));
  const today = new Date().toISOString().slice(0, 10);
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .limit(100)
    .get();

  let rows = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const picker = mapFirestoreJobToPickerRow(d.id, data);
    const deadline = String(data.deadline ?? data.deadlineDate ?? "").slice(0, 10);
    const status = jobStatusFromData(data);
    const updatedAt = picker.updatedAtMs;
    return { picker, deadline, status, updatedAt };
  });

  if (args.overdueOnly) {
    rows = rows.filter(
      (r) =>
        r.deadline &&
        r.deadline < today &&
        !/hotov|dokon|zruš|archiv/i.test(r.status)
    );
  }

  rows.sort((a, b) => b.updatedAt - a.updatedAt);

  const jobs = rows.slice(0, limit).map((r) => ({
    id: r.picker.id,
    label: r.picker.label,
    orderNumber: r.picker.orderNumber,
    title: r.picker.title,
    customerName: r.picker.customerName,
    address: r.picker.address,
    status: r.status ? jobStatusLabel(r.status) : "—",
  }));

  return { jobs };
}

export function secretaryOpenJobTool(jobId: string): Record<string, unknown> {
  const id = String(jobId ?? "").trim();
  if (!id) return { ok: false, error: "Chybí zakázka." };
  return {
    ok: true,
    action: "open_job",
    jobId: id,
    portalPath: `/portal/jobs/${encodeURIComponent(id)}`,
  };
}
