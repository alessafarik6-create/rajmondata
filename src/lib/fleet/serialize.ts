import type { FleetVehicleDoc, FleetTripDoc, FleetDriverAssignmentDoc } from "@/lib/fleet/types";

export function serializeVehicle(row: FleetVehicleDoc & { id: string }) {
  return {
    id: row.id,
    name: row.name,
    licensePlate: row.licensePlate,
    vin: row.vin ?? null,
    make: row.make ?? null,
    model: row.model ?? null,
    year: row.year ?? null,
    notes: row.notes ?? null,
    currentDriverUserId: row.currentDriverUserId ?? null,
    currentDriverEmployeeId: row.currentDriverEmployeeId ?? null,
    currentDriverName: row.currentDriverName ?? null,
    externalProvider: row.externalProvider ?? null,
    externalVehicleId: row.externalVehicleId ?? null,
    externalDeviceId: row.externalDeviceId ?? null,
    lastMovementStatus: row.lastMovementStatus ?? "unknown",
    lastSpeedKmh: row.lastSpeedKmh ?? null,
    lastLatitude: row.lastLatitude ?? null,
    lastLongitude: row.lastLongitude ?? null,
    lastLocationLabel: row.lastLocationLabel ?? null,
    lastPositionAt: row.lastPositionAt?.toDate?.()?.toISOString?.() ?? null,
    todayDistanceKm: row.todayDistanceKm ?? null,
    ignitionOn: row.ignitionOn ?? null,
    active: row.active !== false,
  };
}

export function serializeTrip(row: FleetTripDoc & { id: string }) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    driverUserId: row.driverUserId ?? null,
    driverName: row.driverName ?? null,
    jobId: row.jobId ?? null,
    jobLabel: row.jobLabel ?? null,
    startedAt: row.startedAt?.toDate?.()?.toISOString?.() ?? null,
    endedAt: row.endedAt?.toDate?.()?.toISOString?.() ?? null,
    startAddress: row.startAddress ?? null,
    endAddress: row.endAddress ?? null,
    distanceKm: row.distanceKm ?? null,
    durationMinutes: row.durationMinutes ?? null,
    idleMinutes: row.idleMinutes ?? null,
    avgSpeedKmh: row.avgSpeedKmh ?? null,
    maxSpeedKmh: row.maxSpeedKmh ?? null,
    externalTripId: row.externalTripId ?? null,
  };
}

export function serializeAssignment(row: FleetDriverAssignmentDoc & { id: string }) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    driverUserId: row.driverUserId,
    driverEmployeeId: row.driverEmployeeId ?? null,
    driverName: row.driverName ?? null,
    assignedFrom: row.assignedFrom?.toDate?.()?.toISOString?.() ?? null,
    assignedTo: row.assignedTo?.toDate?.()?.toISOString?.() ?? null,
    note: row.note ?? null,
  };
}
