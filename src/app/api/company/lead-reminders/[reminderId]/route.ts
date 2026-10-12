import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { requirePortalModuleAccess } from "@/lib/portal-permissions-server";
import {
  COMPANIES_COLLECTION,
  LEAD_REMINDERS_SUBCOLLECTION,
} from "@/lib/firestore-collections";
import {
  assertLeadReminderAssigneeOk,
  resolveEmployeeDisplayNameByAuthUid,
  serializeLeadReminder,
} from "@/lib/leads/lead-reminder-api-server";
import { localDateTimeFromParts } from "@/lib/leads/lead-reminder-datetime";
import { fireLeadReminderIfDue } from "@/lib/leads/lead-reminder-fire-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ reminderId: string }> };

async function loadReminder(
  db: import("firebase-admin/firestore").Firestore,
  companyId: string,
  reminderId: string
) {
  const ref = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(LEAD_REMINDERS_SUBCOLLECTION)
    .doc(reminderId);
  const snap = await ref.get();
  if (!snap.exists) return { ref, snap: null as null };
  const data = snap.data() as Record<string, unknown>;
  if (String(data.companyId ?? "") !== companyId) return { ref, snap: null as null };
  return { ref, snap, data };
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { reminderId } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (companyId !== auth.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const action = String(body.action ?? "").trim();
  const loaded = await loadReminder(auth.db, companyId, reminderId);
  if (!loaded.snap || !loaded.data) {
    return NextResponse.json({ ok: false, error: "Připomínka nenalezena." }, { status: 404 });
  }

  const assignedUserId = String(loaded.data.assignedUserId ?? "");
  const isAssignee = assignedUserId === auth.caller.uid;
  const writePerm = await requirePortalModuleAccess(auth.db, auth.caller, "leads", "write");
  const readPerm = await requirePortalModuleAccess(auth.db, auth.caller, "leads", "read");
  if (!readPerm.ok) {
    return NextResponse.json({ ok: false, error: readPerm.error }, { status: readPerm.status });
  }

  if (action === "done") {
    if (!isAssignee && !writePerm.ok) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }
    await loaded.ref.update({
      status: "done",
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "snooze") {
    if (!isAssignee) {
      return NextResponse.json({ ok: false, error: "Odložit může jen přiřazený uživatel." }, { status: 403 });
    }
    const minutes = Number(body.minutes ?? 10);
    const delta = Math.min(24 * 60, Math.max(1, minutes)) * 60 * 1000;
    const next = new Date(Date.now() + delta);
    await loaded.ref.update({
      remindAt: Timestamp.fromDate(next),
      notificationFired: false,
      firedAt: null,
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true, remindAt: next.toISOString() });
  }

  if (action === "fire") {
    if (!isAssignee) {
      return NextResponse.json({ ok: false, error: "Nepovoleno." }, { status: 403 });
    }
    const result = await fireLeadReminderIfDue(auth.db, companyId, reminderId, { graceMs: 60_000 });
    return NextResponse.json({ ok: true, ...result });
  }

  if (!writePerm.ok) {
    return NextResponse.json({ ok: false, error: writePerm.error }, { status: writePerm.status });
  }

  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (body.note != null) {
    patch.note = String(body.note ?? "").slice(0, 2000);
  }

  if (body.assignedUserId != null) {
    const nextAssignee = String(body.assignedUserId).trim();
    const assignCheck = assertLeadReminderAssigneeOk(auth.caller, nextAssignee);
    if (!assignCheck.ok) {
      return NextResponse.json({ ok: false, error: assignCheck.error }, { status: 403 });
    }
    patch.assignedUserId = nextAssignee;
    patch.assignedDisplayName = await resolveEmployeeDisplayNameByAuthUid(
      auth.db,
      companyId,
      nextAssignee
    );
  }

  if (body.remindAtIso || body.dateYmd) {
    let remindAt: Date | null = null;
    if (body.remindAtIso && !Number.isNaN(Date.parse(String(body.remindAtIso)))) {
      remindAt = new Date(String(body.remindAtIso));
    } else {
      remindAt = localDateTimeFromParts(
        String(body.dateYmd ?? ""),
        Number(body.hour ?? 0),
        Number(body.minute ?? 0)
      );
    }
    if (!remindAt || Number.isNaN(remindAt.getTime())) {
      return NextResponse.json({ ok: false, error: "Neplatný termín." }, { status: 400 });
    }
    patch.remindAt = Timestamp.fromDate(remindAt);
    patch.notificationFired = false;
    patch.firedAt = null;
    patch.status = "active";
  }

  await loaded.ref.update(patch);
  const after = await loaded.ref.get();
  return NextResponse.json({
    ok: true,
    reminder: serializeLeadReminder(reminderId, (after.data() ?? {}) as Record<string, unknown>),
  });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const perm = await requirePortalModuleAccess(auth.db, auth.caller, "leads", "write");
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  const { reminderId } = await ctx.params;
  const companyId = String(
    request.nextUrl.searchParams.get("companyId") ?? auth.caller.companyId
  ).trim();
  if (companyId !== auth.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const loaded = await loadReminder(auth.db, companyId, reminderId);
  if (!loaded.snap) {
    return NextResponse.json({ ok: false, error: "Připomínka nenalezena." }, { status: 404 });
  }

  await loaded.ref.delete();
  return NextResponse.json({ ok: true });
}
