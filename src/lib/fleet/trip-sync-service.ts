import type { Firestore } from "firebase-admin/firestore";
import { resolveFleetProviderForOrg } from "@/lib/fleet/providers";
import { listFleetVehicles } from "@/lib/fleet/stores";

/** Stáhne jízdy z GPS providera za posledních N dní (kniha jízd). */
export async function syncRecentFleetTripsForOrganization(
  db: Firestore,
  organizationId: string,
  daysBack = 2
): Promise<{ synced: number; vehicles: number }> {
  const { configured, provider, providerKind } = await resolveFleetProviderForOrg(db, organizationId);
  if (!configured || providerKind !== "SATELITNI_SLEDOVANI") {
    return { synced: 0, vehicles: 0 };
  }
  if (!("syncTripsForVehicle" in provider)) {
    return { synced: 0, vehicles: 0 };
  }

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - daysBack);

  const vehicles = await listFleetVehicles(db, organizationId);
  let synced = 0;
  let count = 0;
  for (const v of vehicles) {
    if (v.archived || v.active === false) continue;
    const ext = String(v.externalVehicleId ?? "").trim();
    if (!ext || v.externalProvider !== "SATELITNI_SLEDOVANI") continue;
    count += 1;
    const n = await (
      provider as import("@/lib/fleet/providers/satelitni-sledovani-provider").SatelitniSledovaniProvider
    ).syncTripsForVehicle(ext, from, to);
    synced += n;
  }
  return { synced, vehicles: count };
}
