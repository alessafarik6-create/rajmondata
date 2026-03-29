/**
 * Foto zaměření — companies/{companyId}/measurement_photos/{photoId}
 * Uložení mimo jobs/{jobId}/photos, dokud není vazba na zakázku (jobId volitelné).
 */

import {
  collection,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
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
  createdAt?: unknown;
  createdBy: string;
  updatedAt?: unknown;
};

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
