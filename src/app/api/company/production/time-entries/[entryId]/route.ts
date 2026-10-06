import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { canManageProductionTasks } from "@/lib/production-qr/production-access";
import {
  productionTimeEntriesCol,
  productionTimeEntryAuditsCol,
} from "@/lib/production-qr/production-task-paths";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ entryId: string }> }
) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canManageProductionTasks(v.caller)) {
    return NextResponse.json({ error: "Úpravu záznamů může provádět vedení." }, { status: 403 });
  }

  const { entryId } = await ctx.params;
  let body: { startedAt?: string; endedAt?: string; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }

  const ref = productionTimeEntriesCol(v.db, v.caller.companyId).doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Záznam neexistuje." }, { status: 404 });
  }
  const before = snap.data() as Record<string, unknown>;

  const startedAt = body.startedAt ? Timestamp.fromDate(new Date(body.startedAt)) : before.startedAt;
  const endedAt =
    body.endedAt === undefined
      ? before.endedAt
      : body.endedAt
        ? Timestamp.fromDate(new Date(body.endedAt))
        : null;

  let durationSeconds: number | null = null;
  if (startedAt instanceof Timestamp && endedAt instanceof Timestamp) {
    durationSeconds = Math.max(
      0,
      Math.round((endedAt.toMillis() - startedAt.toMillis()) / 1000)
    );
  }

  const after = {
    startedAt,
    endedAt,
    durationSeconds,
    endedReason: "admin_edit" as const,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await ref.set(after, { merge: true });
  await productionTimeEntryAuditsCol(v.db, v.caller.companyId).add({
    entryId,
    companyId: v.caller.companyId,
    changedByUserId: v.caller.uid,
    reason: body.reason?.trim() || null,
    before: {
      startedAt: before.startedAt,
      endedAt: before.endedAt,
      durationSeconds: before.durationSeconds,
    },
    after,
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true });
}
