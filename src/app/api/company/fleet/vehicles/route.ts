import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { requireFleetRead, requireFleetWrite, fleetTenantOk } from "@/lib/fleet/api-auth";
import { fleetVehiclesCol, listFleetVehicles } from "@/lib/fleet/stores";
import { serializeVehicle } from "@/lib/fleet/serialize";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const perm = await requireFleetRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!fleetTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const vehicles = await listFleetVehicles(perm.db, companyId);
  return NextResponse.json({ ok: true, vehicles: vehicles.map(serializeVehicle) });
}

export async function POST(request: NextRequest) {
  const perm = await requireFleetWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
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
  const name = String(body.name ?? "").trim();
  const licensePlate = String(body.licensePlate ?? "").trim().toUpperCase();
  if (!name || !licensePlate) {
    return NextResponse.json({ ok: false, error: "Vyplňte název a SPZ." }, { status: 400 });
  }
  const id = crypto.randomUUID();
  await fleetVehiclesCol(perm.db, companyId).doc(id).set({
    organizationId: companyId,
    name,
    licensePlate,
    vin: String(body.vin ?? "").trim() || null,
    make: String(body.make ?? "").trim() || null,
    model: String(body.model ?? "").trim() || null,
    year: body.year != null ? Number(body.year) : null,
    notes: String(body.notes ?? "").trim() || null,
    currentDriverUserId: String(body.currentDriverUserId ?? "").trim() || null,
    currentDriverEmployeeId: String(body.currentDriverEmployeeId ?? "").trim() || null,
    currentDriverName: String(body.currentDriverName ?? "").trim() || null,
    externalProvider: null,
    externalVehicleId: String(body.externalVehicleId ?? "").trim() || null,
    externalDeviceId: String(body.externalDeviceId ?? "").trim() || null,
    lastMovementStatus: "unknown",
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ ok: true, vehicleId: id });
}
