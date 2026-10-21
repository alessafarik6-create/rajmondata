import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { resolveCallerPortalPermissions } from "@/lib/portal-permissions-server";
import { AI_TUTORIALS, getTutorialById } from "@/lib/ai-tutor/tutorial-registry";
import { callerOrgMatch, tutorialAllowedForPermissions } from "@/lib/ai-tutor/access";
import { computeOrganizationMilestones } from "@/lib/ai-tutor/milestones-server";
import { listAiTutorProgressForUser, upsertAiTutorProgress } from "@/lib/ai-tutor/progress-server";
import type { AiTutorialStatus } from "@/lib/ai-tutor/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (!callerOrgMatch(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const [progress, milestones, permissions] = await Promise.all([
    listAiTutorProgressForUser(auth.db, companyId, auth.caller.uid),
    computeOrganizationMilestones(auth.db, companyId),
    resolveCallerPortalPermissions(auth.db, auth.caller),
  ]);

  const role = auth.caller.role;
  const tutorials = AI_TUTORIALS.filter((t) => {
    if (!t.enabled) return false;
    if (!tutorialAllowedForPermissions(t, permissions, role)) return false;
    if (t.hideWhenMilestone && milestones[t.hideWhenMilestone]) return false;
    return true;
  }).map((t) => ({
    id: t.id,
    version: t.version,
    title: t.title,
    summary: t.summary,
    stepCount: t.steps.length,
  }));

  return NextResponse.json({ ok: true, progress, milestones, tutorials });
}

export async function PATCH(request: NextRequest) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"), { method: "PATCH" });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: {
    companyId?: string;
    tutorialId?: string;
    status?: AiTutorialStatus;
    completedSteps?: string[];
    lastStep?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!callerOrgMatch(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const tutorialId = String(body.tutorialId ?? "").trim();
  const tutorial = getTutorialById(tutorialId);
  if (!tutorial) {
    return NextResponse.json({ ok: false, error: "Neznámý průvodce." }, { status: 400 });
  }
  const permissions = await resolveCallerPortalPermissions(auth.db, auth.caller);
  if (!tutorialAllowedForPermissions(tutorial, permissions, auth.caller.role)) {
    return NextResponse.json({ ok: false, error: "Nemáte oprávnění k tomuto průvodci." }, { status: 403 });
  }
  const status = body.status;
  if (!status || !["not_started", "in_progress", "completed", "skipped"].includes(status)) {
    return NextResponse.json({ ok: false, error: "Neplatný stav." }, { status: 400 });
  }

  await upsertAiTutorProgress(auth.db, {
    organizationId: companyId,
    userId: auth.caller.uid,
    tutorialId,
    tutorialVersion: tutorial.version,
    status,
    completedSteps: Array.isArray(body.completedSteps)
      ? body.completedSteps.map(String).slice(0, 50)
      : undefined,
    lastStep: body.lastStep != null ? String(body.lastStep) : null,
  });

  return NextResponse.json({ ok: true });
}
