import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  FLEET_DRIVER_ASSIGNMENTS_SUBCOLLECTION,
  FLEET_INTEGRATION_CREDENTIALS_DOC,
  FLEET_INTEGRATION_DOC_ID,
  FLEET_TRIPS_SUBCOLLECTION,
  FLEET_VEHICLES_SUBCOLLECTION,
  type FleetDriverAssignmentDoc,
  type FleetIntegrationDoc,
  type FleetTripDoc,
  type FleetVehicleDoc,
} from "@/lib/fleet/types";
import { decryptFleetSecret, encryptFleetSecret } from "@/lib/fleet/integration-crypto";

export function fleetVehiclesCol(db: Firestore, companyId: string) {
  return db.collection(COMPANIES_COLLECTION).doc(companyId).collection(FLEET_VEHICLES_SUBCOLLECTION);
}

export function fleetTripsCol(db: Firestore, companyId: string) {
  return db.collection(COMPANIES_COLLECTION).doc(companyId).collection(FLEET_TRIPS_SUBCOLLECTION);
}

export function fleetAssignmentsCol(db: Firestore, companyId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(FLEET_DRIVER_ASSIGNMENTS_SUBCOLLECTION);
}

export function fleetIntegrationRef(db: Firestore, companyId: string) {
  return db.collection(COMPANIES_COLLECTION).doc(companyId).collection("fleet_integration").doc(FLEET_INTEGRATION_DOC_ID);
}

export async function listFleetVehicles(
  db: Firestore,
  companyId: string
): Promise<(FleetVehicleDoc & { id: string })[]> {
  const snap = await fleetVehiclesCol(db, companyId).orderBy("name", "asc").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FleetVehicleDoc) }));
}

export async function loadFleetVehicle(
  db: Firestore,
  companyId: string,
  vehicleId: string
): Promise<(FleetVehicleDoc & { id: string }) | null> {
  const snap = await fleetVehiclesCol(db, companyId).doc(vehicleId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as FleetVehicleDoc) };
}

export async function loadFleetIntegration(
  db: Firestore,
  companyId: string
): Promise<FleetIntegrationDoc | null> {
  const snap = await fleetIntegrationRef(db, companyId).get();
  if (!snap.exists) return null;
  return snap.data() as FleetIntegrationDoc;
}

export async function saveFleetIntegrationCredentials(
  db: Firestore,
  companyId: string,
  apiKey: string
): Promise<void> {
  await fleetIntegrationRef(db, companyId)
    .collection("private")
    .doc(FLEET_INTEGRATION_CREDENTIALS_DOC)
    .set({
      encryptedApiKey: encryptFleetSecret(apiKey),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

export async function loadFleetIntegrationApiKey(
  db: Firestore,
  companyId: string
): Promise<string | null> {
  const snap = await fleetIntegrationRef(db, companyId)
    .collection("private")
    .doc(FLEET_INTEGRATION_CREDENTIALS_DOC)
    .get();
  if (!snap.exists) return null;
  const enc = String((snap.data() as { encryptedApiKey?: string })?.encryptedApiKey ?? "");
  if (!enc) return null;
  try {
    return decryptFleetSecret(enc);
  } catch {
    return null;
  }
}

export async function listFleetTrips(
  db: Firestore,
  companyId: string,
  opts?: { vehicleId?: string; from?: Date; to?: Date; limit?: number }
): Promise<(FleetTripDoc & { id: string })[]> {
  const col = fleetTripsCol(db, companyId);
  const snap = opts?.vehicleId
    ? await col.where("vehicleId", "==", opts.vehicleId).orderBy("startedAt", "desc").limit(opts?.limit ?? 200).get().catch(async () => {
        const raw = await col.where("vehicleId", "==", opts.vehicleId).limit(opts?.limit ?? 200).get();
        return raw;
      })
    : await col.orderBy("startedAt", "desc").limit(opts?.limit ?? 200).get().catch(async () => col.limit(opts?.limit ?? 200).get());
  let rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as FleetTripDoc) }));
  if (opts?.from || opts?.to) {
    const fromMs = opts.from?.getTime() ?? 0;
    const toMs = opts.to?.getTime() ?? Number.MAX_SAFE_INTEGER;
    rows = rows.filter((t) => {
      const ms = t.startedAt?.toMillis?.() ?? 0;
      return ms >= fromMs && ms <= toMs;
    });
  }
  return rows;
}

export async function listDriverAssignmentsForVehicle(
  db: Firestore,
  companyId: string,
  vehicleId: string
): Promise<(FleetDriverAssignmentDoc & { id: string })[]> {
  const snap = await fleetAssignmentsCol(db, companyId)
    .where("vehicleId", "==", vehicleId)
    .orderBy("assignedFrom", "desc")
    .limit(50)
    .get()
    .catch(async () => {
      const fallback = await fleetAssignmentsCol(db, companyId).where("vehicleId", "==", vehicleId).get();
      return fallback;
    });
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as FleetDriverAssignmentDoc) }));
  rows.sort((a, b) => (b.assignedFrom?.toMillis?.() ?? 0) - (a.assignedFrom?.toMillis?.() ?? 0));
  return rows;
}
