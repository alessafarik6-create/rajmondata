import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  assertProductionJobAccess,
  canManageProductionTasks,
} from "@/lib/production-qr/production-access";
import { copyProductionTasksToJob } from "@/lib/production-qr/production-task-admin";
import { productionTasksCol } from "@/lib/production-qr/production-task-paths";

type Body = {
  sourceJobId?: string;
  targetJobId?: string;
  taskIds?: string[];
};

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canManageProductionTasks(v.caller)) {
    return NextResponse.json({ error: "Kopírování může provádět vedení." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }

  const sourceJobId = String(body.sourceJobId ?? "").trim();
  const targetJobId = String(body.targetJobId ?? "").trim();
  const taskIds = Array.isArray(body.taskIds)
    ? body.taskIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  if (!sourceJobId || !targetJobId || taskIds.length === 0) {
    return NextResponse.json(
      { error: "Chybí sourceJobId, targetJobId nebo taskIds." },
      { status: 400 }
    );
  }
  if (sourceJobId === targetJobId) {
    return NextResponse.json({ error: "Cílová zakázka musí být jiná." }, { status: 400 });
  }

  const srcAccess = await assertProductionJobAccess(v.db, v.caller, sourceJobId);
  if (!srcAccess.ok) return NextResponse.json({ error: srcAccess.error }, { status: srcAccess.status });
  const tgtAccess = await assertProductionJobAccess(v.db, v.caller, targetJobId);
  if (!tgtAccess.ok) return NextResponse.json({ error: tgtAccess.error }, { status: tgtAccess.status });

  const targetTasksSnap = await productionTasksCol(v.db, v.caller.companyId, targetJobId)
    .where("active", "==", true)
    .get();
  const targetNames = new Set(
    targetTasksSnap.docs.map((d) => String(d.data().name ?? "").trim().toLowerCase()).filter(Boolean)
  );

  const sourceSnap = await Promise.all(
    taskIds.map((id) =>
      productionTasksCol(v.db, v.caller.companyId, sourceJobId).doc(id).get()
    )
  );
  const duplicateWarnings: string[] = [];
  for (const snap of sourceSnap) {
    if (!snap.exists) continue;
    const nm = String(snap.data()?.name ?? "").trim();
    if (nm && targetNames.has(nm.toLowerCase())) {
      duplicateWarnings.push(nm);
    }
  }

  const { createdIds } = await copyProductionTasksToJob(v.db, {
    companyId: v.caller.companyId,
    sourceJobId,
    targetJobId,
    taskIds,
  });

  return NextResponse.json({
    ok: true,
    createdCount: createdIds.length,
    createdIds,
    duplicateWarnings,
  });
}
