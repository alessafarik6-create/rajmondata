import { NextRequest, NextResponse } from "next/server";
import { requireFleetRead, fleetTenantOk } from "@/lib/fleet/api-auth";
import { listFleetTrips, listFleetVehicles } from "@/lib/fleet/stores";
import {
  buildLogbookRows,
  logbookToPdfBuffer,
  logbookToXlsxBuffer,
} from "@/lib/fleet/logbook-export";

export const dynamic = "force-dynamic";

function csvEscape(v: string): string {
  if (/[",;\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

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

  const format = String(request.nextUrl.searchParams.get("format") ?? "csv").toLowerCase();
  const vehicleId = request.nextUrl.searchParams.get("vehicleId") ?? undefined;
  const driverUserId = request.nextUrl.searchParams.get("driverUserId") ?? undefined;
  const tripType = request.nextUrl.searchParams.get("tripType") ?? undefined;
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;

  let trips = await listFleetTrips(perm.db, companyId, { vehicleId, from, to, limit: 2000 });
  if (driverUserId) trips = trips.filter((t) => t.driverUserId === driverUserId);
  if (tripType === "business" || tripType === "private") {
    trips = trips.filter((t) => (t.tripType ?? "business") === tripType);
  }

  const vehicles = await listFleetVehicles(perm.db, companyId);
  const plateById = new Map(vehicles.map((v) => [v.id, v.licensePlate]));

  const companySnap = await perm.db.collection("companies").doc(companyId).get();
  const orgName = String(companySnap.data()?.name ?? companySnap.data()?.companyName ?? "Organizace");

  const { rows, totalKm } = buildLogbookRows(trips, plateById, orgName);
  const baseName = `kniha-jizd-${companyId.slice(0, 8)}`;

  if (format === "xlsx") {
    const buf = logbookToXlsxBuffer(rows, totalKm);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
      },
    });
  }

  if (format === "pdf") {
    const buf = logbookToPdfBuffer(rows, totalKm, orgName);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
      },
    });
  }

  const header = [
    "Organizace",
    "Vozidlo ID",
    "SPZ",
    "Datum",
    "Odjezd",
    "Příjezd",
    "Odkud",
    "Kam",
    "Km",
    "Typ jízdy",
    "Účel",
    "Řidič",
    "Zakázka",
    "Poznámka",
  ];

  const csvRows = rows.map((r) =>
    [
      r.orgName,
      r.vehicleId,
      r.licensePlate,
      r.started ? r.started.toLocaleDateString("cs-CZ") : "",
      r.started ? r.started.toLocaleTimeString("cs-CZ") : "",
      r.ended ? r.ended.toLocaleTimeString("cs-CZ") : "",
      r.startAddress,
      r.endAddress,
      r.km ? String(r.km).replace(".", ",") : "",
      r.tripTypeCs,
      r.purpose,
      r.driverName,
      r.job,
      r.note,
    ].map((c) => csvEscape(String(c ?? "")))
  );

  csvRows.push(
    ["", "", "", "", "", "", "", "Souhrn km", String(totalKm).replace(".", ","), "", "", "", "", ""].map(csvEscape)
  );

  const csv = "\uFEFF" + [header.join(";"), ...csvRows.map((r) => r.join(";"))].join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}.csv"`,
    },
  });
}
