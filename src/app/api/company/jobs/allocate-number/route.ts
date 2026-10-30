import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import {
  allocateJobNumberAdmin,
  previewNextJobNumberAdmin,
} from "@/lib/jobs/job-numbering-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "jobs",
    method: "POST",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const companyId = String(body.companyId ?? v.caller.companyId).trim();
  if (companyId !== v.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const jobTag = body.jobTag != null ? String(body.jobTag).trim() : null;
  const typeId = body.typeId != null ? String(body.typeId).trim() : null;
  const preview = body.preview === true;

  try {
    if (preview) {
      const out = await previewNextJobNumberAdmin(v.db, companyId, jobTag, { typeId });
      return NextResponse.json({ ok: true, preview: out.preview, typeId: out.typeId });
    }
    const { jobNumber, typeId: assignedTypeId } = await allocateJobNumberAdmin(
      v.db,
      companyId,
      jobTag,
      { typeId }
    );
    return NextResponse.json({ ok: true, jobNumber, typeId: assignedTypeId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "DUPLICATE_JOB_NUMBER") {
      return NextResponse.json({ ok: false, error: "Kolize čísla zakázky, zkuste znovu." }, { status: 409 });
    }
    console.error("[allocate-number]", msg);
    return NextResponse.json({ ok: false, error: "Nepodařilo přidělit číslo zakázky." }, { status: 500 });
  }
}
