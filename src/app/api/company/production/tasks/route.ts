import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { Timestamp } from "firebase-admin/firestore";
import {
  assertProductionJobAccess,
  canManageProductionTasks,
} from "@/lib/production-qr/production-access";
import { createProductionTask } from "@/lib/production-qr/production-task-admin";
import { productionTasksCol, resolveProductionScanUrl } from "@/lib/production-qr/production-task-paths";

function tsIso(v: unknown): string | null {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return null;
}

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const jobId = String(request.nextUrl.searchParams.get("jobId") ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });

  const access = await assertProductionJobAccess(v.db, v.caller, jobId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const snap = await productionTasksCol(v.db, v.caller.companyId, jobId)
    .orderBy("sortOrder", "asc")
    .get();
  const origin = request.nextUrl.origin;
  const tasks = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const token = String(data.publicToken ?? "");
    return {
      id: d.id,
      name: String(data.name ?? ""),
      description: data.description ?? null,
      status: String(data.status ?? "new"),
      active: data.active !== false,
      sortOrder: Number(data.sortOrder ?? 0),
      plannedMinutes: data.plannedMinutes ?? null,
      publicToken: token,
      scanUrl: token ? resolveProductionScanUrl(origin, token) : null,
      createdAt: tsIso(data.createdAt),
      updatedAt: tsIso(data.updatedAt),
    };
  });
  return NextResponse.json({ ok: true, tasks });
}

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canManageProductionTasks(v.caller)) {
    return NextResponse.json({ error: "Úpravu úkolů může provádět vedení." }, { status: 403 });
  }

  let body: { jobId?: string; name?: string; description?: string; sortOrder?: number; plannedMinutes?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!jobId || !name) {
    return NextResponse.json({ error: "Chybí jobId nebo název." }, { status: 400 });
  }
  const access = await assertProductionJobAccess(v.db, v.caller, jobId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const created = await createProductionTask(v.db, {
    companyId: v.caller.companyId,
    jobId,
    name,
    description: body.description,
    sortOrder: body.sortOrder,
    plannedMinutes: body.plannedMinutes,
  });
  const origin = request.nextUrl.origin;
  return NextResponse.json({
    ok: true,
    taskId: created.taskId,
    scanUrl: resolveProductionScanUrl(origin, created.publicToken),
  });
}
