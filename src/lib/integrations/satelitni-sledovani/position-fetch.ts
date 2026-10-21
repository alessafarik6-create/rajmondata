import type { Firestore } from "firebase-admin/firestore";
import { satelitniRequest, unwrapSatelitniResource } from "@/lib/integrations/satelitni-sledovani/client";
import {
  mapSatelitniLatestPosition,
  pickSatelitniExternalVehicleId,
  type SatelitniPositionApi,
  type SatelitniVehicleApi,
} from "@/lib/integrations/satelitni-sledovani/mappers";
import { SatelitniApiError } from "@/lib/integrations/satelitni-sledovani/problem-json";
import type { FleetVehicleDoc } from "@/lib/fleet/types";

/** ID pro URL `/vehicles/{id}/positions/latest` — stabilní vehicle id, ne SPZ. */
export function satelitniPositionUrlIdCandidates(
  vehicle: Pick<FleetVehicleDoc, "externalVehicleId" | "externalDeviceId">,
  apiRow?: SatelitniVehicleApi | null
): string[] {
  const out: string[] = [];
  const add = (raw: unknown) => {
    const s = String(raw ?? "").trim();
    if (!s || s === "0" || out.includes(s)) return;
    out.push(s);
  };

  add(vehicle.externalVehicleId);
  if (apiRow) {
    add(pickSatelitniExternalVehicleId(apiRow));
    add(apiRow.id);
    add(apiRow.vehicle_id ?? apiRow.vehicleId);
    add(apiRow.code ?? apiRow.vehicle_code);
  }
  if (
    vehicle.externalDeviceId &&
    vehicle.externalDeviceId !== vehicle.externalVehicleId
  ) {
    add(vehicle.externalDeviceId);
  }
  return out;
}

export async function fetchSatelitniLatestPosition(
  db: Firestore,
  organizationId: string,
  idCandidates: string[]
): Promise<ReturnType<typeof mapSatelitniLatestPosition>> {
  for (const id of idCandidates) {
    try {
      const { data } = await satelitniRequest<SatelitniPositionApi>(
        db,
        organizationId,
        `/vehicles/${encodeURIComponent(id)}/positions/latest`
      );
      const pos = mapSatelitniLatestPosition(unwrapSatelitniResource(data));
      if (pos) return pos;
    } catch (e) {
      if (e instanceof SatelitniApiError && (e.httpStatus === 404 || e.httpStatus === 400)) {
        continue;
      }
      throw e;
    }
  }
  return null;
}
