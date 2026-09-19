import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { requireFleetWrite, fleetTenantOk } from "@/lib/fleet/api-auth";
import { fleetAssignmentsCol, fleetVehiclesCol, loadFleetVehicle } from "@/lib/fleet/stores";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ vehicleId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const perm = await requireFleetWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const { vehicleId } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  if (!fleetTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const vehicle = await loadFleetVehicle(perm.db, companyId, vehicleId);
  if (!vehicle) {
    return NextResponse.json({ ok: false, error: "Vozidlo nenalezeno." }, { status: 404 });
  }
  const driverUserId = String(body.driverUserId ?? "").trim();
  const driverName = String(body.driverName ?? "").trim();
  if (!driverUserId) {
    return NextResponse.json({ ok: false, error: "Vyberte řidiče." }, { status: 400 });
  }

  const now = Timestamp.fromDate(new Date());
  const openSnap = await fleetAssignmentsCol(perm.db, companyId)
    .where("vehicleId", "==", vehicleId)
    .where("assignedTo", "==", null)
    .limit(5)
    .get();
  for (const d of openSnap.docs) {
    await d.ref.update({ assignedTo: now, updatedAt: FieldValue.serverTimestamp() });
  }

  const id = crypto.randomUUID();
  await fleetAssignmentsCol(perm.db, companyId).doc(id).set({
    organizationId: companyId,
    vehicleId,
    driverUserId,
    driverEmployeeId: String(body.driverEmployeeId ?? "").trim() || null,
    driverName: driverName || null,
    assignedFrom: now,
    assignedTo: null,
    note: String(body.note ?? "").trim() || null,
    createdByUserId: perm.caller.uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  await fleetVehiclesCol(perm.db, companyId).doc(vehicleId).update({
    currentDriverUserId: driverUserId,
    currentDriverEmployeeId: String(body.driverEmployeeId ?? "").trim() || null,
    currentDriverName: driverName || null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, assignmentId: id });
}
