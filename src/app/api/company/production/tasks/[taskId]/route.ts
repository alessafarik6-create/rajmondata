import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  assertProductionJobAccess,
  canManageProductionTasks,
} from "@/lib/production-qr/production-access";
import { productionTasksCol } from "@/lib/production-qr/production-task-paths";
import {
  closeActiveProductionEntriesForTask,
  productionTaskHasTimeHistory,
} from "@/lib/production-qr/production-time-server";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canManageProductionTasks(v.caller)) {
    return NextResponse.json({ error: "Úpravu úkolů může provádět vedení." }, { status: 403 });
  }
  const { taskId } = await ctx.params;
  const jobId = String(request.nextUrl.searchParams.get("jobId") ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });

  const access = await assertProductionJobAccess(v.db, v.caller, jobId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (body.name != null) patch.name = String(body.name).trim();
  if (body.description != null) patch.description = String(body.description).trim() || null;
  if (body.nameUk != null) patch.nameUk = String(body.nameUk).trim() || null;
  if (body.descriptionUk != null) patch.descriptionUk = String(body.descriptionUk).trim() || null;
  if (body.activityType != null) patch.activityType = String(body.activityType).trim() || null;
  if (body.sortOrder != null) patch.sortOrder = Number(body.sortOrder);
  if (body.plannedMinutes != null) patch.plannedMinutes = Number(body.plannedMinutes) || null;
  if (body.active != null) patch.active = Boolean(body.active);
  if (body.archived != null) patch.archived = Boolean(body.archived);
  if (body.status != null) {
    const st = String(body.status);
    if (["new", "in_progress", "done"].includes(st)) patch.status = st;
  }

  const ref = productionTasksCol(v.db, v.caller.companyId, jobId).doc(taskId);
  await ref.set(patch, { merge: true });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canManageProductionTasks(v.caller)) {
    return NextResponse.json({ error: "Smazání může provádět vedení." }, { status: 403 });
  }
  const { taskId } = await ctx.params;
  const jobId = String(request.nextUrl.searchParams.get("jobId") ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });

  const access = await assertProductionJobAccess(v.db, v.caller, jobId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const ref = productionTasksCol(v.db, v.caller.companyId, jobId).doc(taskId);
  const hasHistory = await productionTaskHasTimeHistory(v.db, v.caller.companyId, taskId);
  await closeActiveProductionEntriesForTask(v.db, {
    companyId: v.caller.companyId,
    jobId,
    productionTaskId: taskId,
  });

  if (hasHistory) {
    await ref.set(
      {
        active: false,
        archived: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return NextResponse.json({ ok: true, archived: true });
  }

  await ref.set({ active: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return NextResponse.json({ ok: true, archived: false });
}
