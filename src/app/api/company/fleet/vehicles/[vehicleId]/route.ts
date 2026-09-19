import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireFleetRead, requireFleetWrite, fleetTenantOk } from "@/lib/fleet/api-auth";
import { fleetVehiclesCol, loadFleetVehicle, listDriverAssignmentsForVehicle } from "@/lib/fleet/stores";
import { serializeAssignment, serializeVehicle } from "@/lib/fleet/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ vehicleId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const perm = await requireFleetRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!fleetTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const { vehicleId } = await ctx.params;
  const vehicle = await loadFleetVehicle(perm.db, companyId, vehicleId);
  if (!vehicle || vehicle.organizationId !== companyId) {
    return NextResponse.json({ ok: false, error: "Vozidlo nenalezeno." }, { status: 404 });
  }
  const assignments = await listDriverAssignmentsForVehicle(perm.db, companyId, vehicleId);
  return NextResponse.json({
    ok: true,
    vehicle: serializeVehicle(vehicle),
    assignments: assignments.map(serializeAssignment),
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
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
  const ref = fleetVehiclesCol(perm.db, companyId).doc(vehicleId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "Vozidlo nenalezeno." }, { status: 404 });
  }
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  const fields = [
    "name",
    "licensePlate",
    "vin",
    "make",
    "model",
    "year",
    "notes",
    "currentDriverUserId",
    "currentDriverEmployeeId",
    "currentDriverName",
    "externalVehicleId",
    "externalDeviceId",
    "externalProvider",
  ] as const;
  for (const f of fields) {
    if (body[f] !== undefined) patch[f] = body[f];
  }
  if (typeof body.licensePlate === "string") {
    patch.licensePlate = body.licensePlate.trim().toUpperCase();
  }
  await ref.update(patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const perm = await requireFleetWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const companyId = String(request.nextUrl.searchParams.get("companyId") ?? "").trim();
  const { vehicleId } = await ctx.params;
  if (!fleetTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  await fleetVehiclesCol(perm.db, companyId).doc(vehicleId).delete();
  return NextResponse.json({ ok: true });
}
