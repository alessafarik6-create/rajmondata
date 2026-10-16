import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import {
  DEFAULT_JOB_NUMBERING_SETTINGS,
  parseJobNumberingSettings,
  previewNextJobNumber,
} from "@/lib/jobs/job-numbering";
import { jobNumberCounterDocId } from "@/lib/jobs/job-numbering";
import { pragueCalendarYear, loadJobNumberingSettings } from "@/lib/jobs/job-numbering-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "jobs",
    method: "GET",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const url = new URL(request.url);
  const companyId = String(url.searchParams.get("companyId") ?? v.caller.companyId).trim();
  if (companyId !== v.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const settings = await loadJobNumberingSettings(v.db, companyId);
  const year = pragueCalendarYear();
  const previews: Record<string, { lastAssigned: string | null; nextPreview: string }> = {};

  for (const rule of settings.types) {
    const counterId = jobNumberCounterDocId(settings, rule.id, year);
    const counterSnap = await v.db
      .collection("companies")
      .doc(companyId)
      .collection("job_number_counters")
      .doc(counterId)
      .get();
    const start = rule.startSequence ?? 1;
    const nextSeq = counterSnap.exists
      ? Math.max(start, Number(counterSnap.data()?.nextSequence ?? start))
      : start;
    previews[rule.id] = {
      lastAssigned: counterSnap.exists
        ? String(counterSnap.data()?.lastAssigned ?? "").trim() || null
        : null,
      nextPreview: previewNextJobNumber(settings, rule, nextSeq, year),
    };
  }

  return NextResponse.json({
    ok: true,
    settings,
    defaults: DEFAULT_JOB_NUMBERING_SETTINGS,
    previews,
  });
}

export async function PATCH(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "jobs",
    method: "PATCH",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const role = v.caller.role;
  const canManage =
    role === "owner" || role === "admin" || v.caller.globalRoles.includes("super_admin");
  if (!canManage) {
    return NextResponse.json({ ok: false, error: "Pouze administrátor organizace." }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? v.caller.companyId).trim();
  if (companyId !== v.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const settings = parseJobNumberingSettings(body.settings ?? body.jobNumberingSettings);
  await v.db.collection("companies").doc(companyId).set(
    {
      jobNumberingSettings: settings,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, settings });
}
