/**
 * Foto zaměření — companies/{companyId}/measurement_photos/{photoId}
 * Uložení mimo jobs/{jobId}/photos, dokud není vazba na zakázku (jobId volitelné).
 */

import {
  collection,
  deleteField,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

export const MEASUREMENT_PHOTO_SOURCE_TYPE = "measurement-photo" as const;

export type MeasurementPhotoStatus = "draft" | "linked" | "transferred";

export type MeasurementPhotoDoc = {
  id: string;
  companyId: string;
  sourceType: typeof MEASUREMENT_PHOTO_SOURCE_TYPE;
  customerId?: string | null;
  jobId?: string | null;
  measurementId?: string | null;
  originalImageUrl: string;
  annotatedImageUrl?: string | null;
  storagePath?: string | null;
  annotatedStoragePath?: string | null;
  annotationData?: unknown;
  title?: string | null;
  note?: string | null;
  status?: MeasurementPhotoStatus;
  /** Typ záznamu (např. měření u zakázky). */
  kind?: string | null;
  /** Volitelný zdroj zápisu (např. job_measurement_photo po anotaci na zakázce). */
  source?: string | null;
  /**
   * true = patří k zakázce, ale čeká na zařazení (přehled na dashboardu).
   * Stará data bez pole = považuj za již zařazená.
   */
  unassigned?: boolean | null;
  classificationStatus?: "unassigned" | "assigned" | string | null;
  /** Např. `job` | `measurement` po přiřazení z přehledu. */
  assignedType?: string | null;
  assignedAt?: unknown;
  assignedBy?: string | null;
  createdAt?: unknown;
  createdBy: string;
  updatedAt?: unknown;
};

/**
 * Na detailu zakázky: štítek „nezařazená“ jen když fotka nemá vazbu na zakázku,
 * nebo je explicitně označená jako nezařazená bez jobId.
 * Pokud existuje jobId, považujeme záznam za zařazený (fallback pro stará pole unassigned / classificationStatus).
 */
/**
 * Ve výrobě: zaměstnanec uvidí fotku zaměření, pokud není interní / účetní a nemá výslovný zákaz.
 * Stará data bez polí viditelnosti považujeme za určená pro realizaci (zpětná kompatibilita oproti složkám).
 */
export function isMeasurementPhotoVisibleInProduction(
  data: Record<string, unknown>,
  isPrivilegedViewer: boolean
): boolean {
  if (isPrivilegedViewer) return true;
  if (data.internalOnly === true || data.internal_only === true) return false;
  const lk = String(data.ledgerKind ?? "").toLowerCase();
  if (lk === "income" || lk === "expense") return false;
  if (data.employeeVisible === false || data.visibleToEmployees === false) return false;
  if (data.visible_to_employees === false) return false;
  if (data.employeeVisible === true || data.visibleToEmployees === true) return true;
  if (data.visible_to_employees === true) return true;
  return true;
}

export function isMeasurementPhotoUnassignedForJob(data: Record<string, unknown>): boolean {
  const jobId = data.jobId;
  if (typeof jobId === "string" && jobId.trim()) {
    return false;
  }
  if (data.classificationStatus === "assigned" || data.unassigned === false) {
    return false;
  }
  if (data.classificationStatus === "unassigned" || data.unassigned === true) {
    return true;
  }
  return false;
}

const trimStr = (v: unknown): string =>
  typeof v === "string" ? v.trim() : "";

/**
 * Platná vazba: zakázka (jobId) nebo zaměření (measurementId + assignedType measurement).
 * Bez toho nesmí být `unassigned: false`.
 */
export function measurementPhotoHasValidAssignment(data: Record<string, unknown>): boolean {
  if (trimStr(data.jobId)) return true;
  const at = trimStr(data.assignedType);
  if (at === "measurement" && trimStr(data.measurementId)) return true;
  return false;
}

/** `unassigned: false`, ale chybí jobId i platná vazba na zaměření — záznam je v nekonzistentním stavu. */
export function measurementPhotoIsOrphanAssigned(data: Record<string, unknown>): boolean {
  if (data.unassigned !== false) return false;
  return !measurementPhotoHasValidAssignment(data);
}

/**
 * Opraví až `limitCount` dokumentů s `unassigned: false` bez platné vazby (vrátí je mezi nezařazené).
 * Vhodné spustit jednou po načtení přehledu (admin).
 */
export async function repairOrphanAssignedMeasurementPhotos(
  firestore: Firestore,
  companyId: string,
  limitCount = 400
): Promise<number> {
  const col = collection(firestore, "companies", companyId, "measurement_photos");
  const snap = await getDocs(query(col, where("unassigned", "==", false), limit(limitCount)));
  const refs = snap.docs
    .filter((d) => measurementPhotoIsOrphanAssigned(d.data() as Record<string, unknown>))
    .map((d) => d.ref);
  let fixed = 0;
  const chunk = 450;
  for (let i = 0; i < refs.length; i += chunk) {
    const batch = writeBatch(firestore);
    const slice = refs.slice(i, i + chunk);
    for (const ref of slice) {
      batch.update(ref, {
        unassigned: true,
        classificationStatus: "unassigned",
        assignedType: deleteField(),
        assignedAt: deleteField(),
        assignedBy: deleteField(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    fixed += slice.length;
  }
  return fixed;
}

/** Po převodu zaměření na zakázku doplní jobId u fotek navázaných na measurementId. */
export async function linkMeasurementPhotosToConvertedJob(
  firestore: Firestore,
  companyId: string,
  measurementId: string,
  jobId: string
): Promise<number> {
  const col = collection(firestore, "companies", companyId, "measurement_photos");
  const snap = await getDocs(
    query(col, where("measurementId", "==", measurementId), limit(200))
  );
  let n = 0;
  for (const d of snap.docs) {
    const data = d.data() as { jobId?: string | null };
    if (data.jobId) continue;
    await updateDoc(d.ref, {
      jobId,
      status: "linked" as MeasurementPhotoStatus,
      updatedAt: serverTimestamp(),
    });
    n += 1;
  }
  return n;
}
