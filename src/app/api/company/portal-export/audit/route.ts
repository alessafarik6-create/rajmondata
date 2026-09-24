import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import type { PortalModuleId } from "@/lib/portal-permissions";
import { requirePortalModuleAccess } from "@/lib/portal-permissions-server";

type Body = {
  actionType?: string;
  moduleId?: PortalModuleId;
  entityType?: string;
  entityId?: string | null;
  entityName?: string | null;
  format?: string;
  metadata?: Record<string, unknown>;
};

const ALLOWED_ACTIONS = new Set([
  "DOCUMENT_PRINTED",
  "DOCUMENT_EXPORTED",
  "JOB_EXPORTED",
  "FINANCE_EXPORT_CREATED",
]);

export async function POST(request: NextRequest) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }

  const actionType = String(body.actionType ?? "").trim();
  if (!ALLOWED_ACTIONS.has(actionType)) {
    return NextResponse.json({ error: "Neplatný typ akce." }, { status: 400 });
  }

  const moduleId = (body.moduleId ?? "jobs") as PortalModuleId;
  const access = await requirePortalModuleAccess(auth.db, auth.caller, moduleId, "read");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const companyId = auth.caller.companyId;
  await auth.db.collection("companies").doc(companyId).collection("activityLogs").add({
    organizationId: companyId,
    companyId,
    userId: auth.caller.uid,
    actionType: actionType.slice(0, 120),
    actionLabel: actionType.replace(/_/g, " "),
    entityType: String(body.entityType ?? "export").slice(0, 80),
    entityId: body.entityId ? String(body.entityId).slice(0, 200) : null,
    entityName: body.entityName ? String(body.entityName).slice(0, 500) : null,
    sourceModule: moduleId,
    details: JSON.stringify({
      format: body.format ?? null,
      metadata: body.metadata ?? null,
    }).slice(0, 4000),
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true });
}
