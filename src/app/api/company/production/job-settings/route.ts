import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  isCompanyPrivileged,
  verifyCompanyBearer,
} from "@/lib/api-company-auth";
import type { ProductionCustomerDisplayMode } from "@/lib/job-production-settings";
import {
  isProductionWorkflowStatus,
  type ProductionWorkflowStatus,
} from "@/lib/production-job-workflow";

type Body = {
  jobId?: string;
  productionAssignedEmployeeIds?: string[];
  productionCustomerDisplayMode?: ProductionCustomerDisplayMode;
  productionInternalLabel?: string | null;
  productionVisibleFolderIds?: string[];
  productionStatusNote?: string | null;
  productionTeamNotes?: string | null;
  /** Workflow výroby u zakázky — mění jen vedení. */
  productionWorkflowStatus?: ProductionWorkflowStatus;
};

/**
 * Nastavení výrobního týmu u zakázky (pouze owner / admin / manager).
 */
export async function PATCH(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;
  if (!isCompanyPrivileged(caller.role, caller.globalRoles)) {
    return NextResponse.json(
      { error: "Změnu může provést jen vedení organizace." },
      { status: 403 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const jobId = String(body.jobId || "").trim();
  if (!jobId) {
    return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });
  }

  const jobRef = db.collection("companies").doc(caller.companyId).collection("jobs").doc(jobId);
  const snap = await jobRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Zakázka neexistuje." }, { status: 404 });
  }

  const ids = Array.isArray(body.productionAssignedEmployeeIds)
    ? body.productionAssignedEmployeeIds.map((x) => String(x).trim()).filter(Boolean)
    : undefined;

  const mode = body.productionCustomerDisplayMode;
  const modeNorm: ProductionCustomerDisplayMode | undefined =
    mode === "internal_only" || mode === "show_customer" ? mode : undefined;

  const folderIds = Array.isArray(body.productionVisibleFolderIds)
    ? body.productionVisibleFolderIds.map((x) => String(x).trim()).filter(Boolean)
    : undefined;

  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (ids) patch.productionAssignedEmployeeIds = ids;
  if (modeNorm) patch.productionCustomerDisplayMode = modeNorm;
  if (body.productionInternalLabel !== undefined) {
    const s = body.productionInternalLabel == null ? "" : String(body.productionInternalLabel).trim();
    patch.productionInternalLabel = s || null;
  }
  if (folderIds) patch.productionVisibleFolderIds = folderIds;
  if (body.productionStatusNote !== undefined) {
    const s = body.productionStatusNote == null ? "" : String(body.productionStatusNote).trim();
    patch.productionStatusNote = s || null;
  }
  if (body.productionTeamNotes !== undefined) {
    const s = body.productionTeamNotes == null ? "" : String(body.productionTeamNotes).trim();
    patch.productionTeamNotes = s || null;
  }
  if (body.productionWorkflowStatus !== undefined) {
    const w = String(body.productionWorkflowStatus || "").trim();
    if (!isProductionWorkflowStatus(w)) {
      return NextResponse.json({ error: "Neplatný productionWorkflowStatus." }, { status: 400 });
    }
    patch.productionWorkflowStatus = w;
  }

  await jobRef.update(patch);
  return NextResponse.json({ ok: true });
}
