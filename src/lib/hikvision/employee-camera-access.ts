import type { Firestore } from "firebase-admin/firestore";
import {
  HIKVISION_EMPLOYEE_CAMERA_ACCESS_SUBCOLLECTION,
  type HikvisionEmployeeCameraAccessDoc,
} from "@/lib/hikvision/types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

function accessCol(db: Firestore, companyId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(HIKVISION_EMPLOYEE_CAMERA_ACCESS_SUBCOLLECTION);
}

/** Per-camera ACL — UI zatím volitelné; backend připraven. */
export async function listEmployeeCameraAccess(
  db: Firestore,
  companyId: string,
  employeeId: string
): Promise<HikvisionEmployeeCameraAccessDoc[]> {
  const snap = await accessCol(db, companyId).where("employeeId", "==", employeeId).get();
  return snap.docs.map((d) => d.data() as HikvisionEmployeeCameraAccessDoc);
}

export async function filterCamerasForEmployee<T extends { id: string }>(
  db: Firestore,
  companyId: string,
  employeeId: string,
  isPrivileged: boolean,
  cameras: T[]
): Promise<T[]> {
  if (isPrivileged) return cameras;
  const rules = await listEmployeeCameraAccess(db, companyId, employeeId);
  if (rules.length === 0) return cameras;
  const allowed = new Set(
    rules.filter(
      (r) =>
        r.canView === true ||
        r.canViewLive ||
        r.canPlayback ||
        r.canControl === true
    ).map((r) => r.cameraId)
  );
  return cameras.filter((c) => allowed.has(c.id));
}

export function employeeCanAccessCamera(
  rules: HikvisionEmployeeCameraAccessDoc[],
  cameraId: string,
  need: "view" | "live" | "playback" | "control"
): boolean {
  if (rules.length === 0) return true;
  const row = rules.find((r) => r.cameraId === cameraId);
  if (!row) return false;
  const canView =
    row.canView === true || row.canViewLive || row.canPlayback || row.canControl === true;
  switch (need) {
    case "view":
      return canView;
    case "live":
      return row.canViewLive;
    case "playback":
      return row.canPlayback;
    case "control":
      return row.canControl === true;
    default:
      return false;
  }
}

/** @deprecated use employeeCanAccessCamera */
export function employeeCanPlaybackCamera(
  rules: HikvisionEmployeeCameraAccessDoc[],
  cameraId: string
): boolean {
  return employeeCanAccessCamera(rules, cameraId, "playback");
}
