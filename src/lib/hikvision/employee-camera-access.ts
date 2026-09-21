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
  const allowed = new Set(rules.filter((r) => r.canViewLive || r.canPlayback).map((r) => r.cameraId));
  return cameras.filter((c) => allowed.has(c.id));
}

export function employeeCanPlaybackCamera(
  rules: HikvisionEmployeeCameraAccessDoc[],
  cameraId: string
): boolean {
  if (rules.length === 0) return true;
  return rules.some((r) => r.cameraId === cameraId && r.canPlayback);
}
