/**
 * Oprávnění k odeslání dokumentu ze zakázky (≠ správa e-mailových schránek).
 */
import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import type { DocumentEmailType } from "@/lib/document-email-outbound";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { computeEffectivePortalAccessForCaller } from "@/lib/portal-effective-access-server";
import {
  canAccessPortalModule,
  type PortalAccessLevel,
  type PortalModuleId,
} from "@/lib/portal-permissions";

export function documentEmailSendAllowedForPermissions(
  type: DocumentEmailType,
  permissions: Record<PortalModuleId, PortalAccessLevel>
): boolean {
  const jobsWrite = canAccessPortalModule(permissions, "jobs", "write");
  const invoicesRead = canAccessPortalModule(permissions, "invoices", "read");
  const invoicesWrite = canAccessPortalModule(permissions, "invoices", "write");
  const documentsRead = canAccessPortalModule(permissions, "documents", "read");
  const documentsWrite = canAccessPortalModule(permissions, "documents", "write");
  const offersRead = canAccessPortalModule(permissions, "offers", "read");
  const offersWrite = canAccessPortalModule(permissions, "offers", "write");
  const meetingWrite = canAccessPortalModule(permissions, "meetingRecords", "write");

  switch (type) {
    case "contract":
    case "job_attachments":
    case "material_order":
      return jobsWrite;
    case "invoice":
    case "advance_invoice":
      return jobsWrite || invoicesRead || invoicesWrite;
    case "received_document":
    case "issued_document":
      return documentsWrite || documentsRead || jobsWrite;
    case "handover_protocol":
      return jobsWrite;
    case "meeting_record":
      return meetingWrite || jobsWrite;
    default:
      return jobsWrite || offersWrite || offersRead;
  }
}

async function assertJobInCompany(
  db: Firestore,
  companyId: string,
  jobId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .doc(jobId)
    .get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Zakázka nenalezena." };
  }
  const data = snap.data() as Record<string, unknown>;
  const docOrg = String(data.companyId ?? data.organizationId ?? "").trim();
  if (docOrg && docOrg !== companyId) {
    return { ok: false, status: 403, error: "Zakázka nepatří do této organizace." };
  }
  return { ok: true };
}

async function assertInvoiceInCompany(
  db: Firestore,
  companyId: string,
  invoiceId: string,
  expectedJobId?: string | null
): Promise<{ ok: true; jobId: string | null } | { ok: false; status: number; error: string }> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("invoices")
    .doc(invoiceId)
    .get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Doklad nenalezen." };
  }
  const data = snap.data() as Record<string, unknown>;
  const jobId = String(data.jobId ?? "").trim() || null;
  const exp = String(expectedJobId ?? "").trim();
  if (exp && jobId && jobId !== exp) {
    return { ok: false, status: 403, error: "Doklad nepatří k uvedené zakázce." };
  }
  return { ok: true, jobId };
}

export async function requireDocumentEmailSendAccess(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  input: {
    companyId: string;
    type: DocumentEmailType;
    jobId?: string | null;
    invoiceId?: string | null;
    contractId?: string | null;
    documentId?: string | null;
  }
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const companyId = String(input.companyId ?? "").trim();
  if (!companyId) {
    return { ok: false, status: 400, error: "Chybí organizace." };
  }
  if (
    caller.companyId !== companyId &&
    !caller.globalRoles.includes("super_admin")
  ) {
    return { ok: false, status: 403, error: "Nemáte přístup k organizaci." };
  }

  const { permissions } = await computeEffectivePortalAccessForCaller(db, caller);
  if (!documentEmailSendAllowedForPermissions(input.type, permissions)) {
    return {
      ok: false,
      status: 403,
      error:
        "K odeslání tohoto dokumentu nemáte oprávnění. U smluv a příloh zakázky je potřeba Zakázky = Zápis; u faktur stačí přístup k fakturaci nebo zápis u zakázek.",
    };
  }

  const jobId = String(input.jobId ?? "").trim();
  const needsJob =
    input.type === "contract" ||
    input.type === "job_attachments" ||
    input.type === "material_order" ||
    input.type === "handover_protocol";

  if (needsJob) {
    if (!jobId) {
      return { ok: false, status: 400, error: "Chybí zakázka." };
    }
    const jobCheck = await assertJobInCompany(db, companyId, jobId);
    if (!jobCheck.ok) return jobCheck;
  } else if (jobId) {
    const jobCheck = await assertJobInCompany(db, companyId, jobId);
    if (!jobCheck.ok) return jobCheck;
  }

  const invoiceId = String(input.invoiceId ?? "").trim();
  if (
    (input.type === "invoice" || input.type === "advance_invoice") &&
    invoiceId
  ) {
    const inv = await assertInvoiceInCompany(db, companyId, invoiceId, jobId || null);
    if (!inv.ok) return inv;
  }

  if (
    (input.type === "received_document" || input.type === "issued_document") &&
    input.documentId
  ) {
    const docId = String(input.documentId).trim();
    const docSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("documents")
      .doc(docId)
      .get();
    if (!docSnap.exists) {
      return { ok: false, status: 404, error: "Doklad nenalezen." };
    }
    const d = docSnap.data() as Record<string, unknown>;
    const docJob = String(d.jobId ?? "").trim();
    if (docJob && jobId && docJob !== jobId) {
      return { ok: false, status: 403, error: "Doklad nepatří k uvedené zakázce." };
    }
  }

  if (input.type === "contract" && input.contractId && jobId) {
    const cid = String(input.contractId).trim();
    const cSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("jobs")
      .doc(jobId)
      .collection("workContracts")
      .doc(cid)
      .get();
    if (!cSnap.exists) {
      return { ok: false, status: 404, error: "Smlouva nenalezena u zakázky." };
    }
  }

  return { ok: true };
}
