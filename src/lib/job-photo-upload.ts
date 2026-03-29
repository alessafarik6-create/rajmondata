/**
 * Jednotný upload fotek zakázky přes oficiální Firebase Storage SDK (ref + uploadBytes + getDownloadURL).
 * Žádné ruční fetch/XHR na firebasestorage.googleapis.com.
 */

import {
  ref,
  uploadBytes,
  getDownloadURL,
  type UploadResult,
} from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import { firebaseConfig } from "@/firebase/config";

export const JOB_PHOTO_UPLOAD_BYTES_TIMEOUT_MS = 3 * 60 * 1000;
export const JOB_PHOTO_DOWNLOAD_URL_TIMEOUT_MS = 60 * 1000;

const DEBUG_JOB_PHOTO =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEBUG_JOB_PHOTO_UPLOAD === "1";

export function promiseWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        new Error(
          `${label}: překročen čas ${Math.round(ms / 1000)} s (zkontrolujte síť, Firebase Storage a pravidla).`
        )
      );
    }, ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

/**
 * Kanonická cesta objektu ve Storage (shodná s Firebase Console „path“).
 * companies/{companyId}/jobs/{jobId}/photos/{timestamp}-{filename}
 */
export function buildJobPhotoStorageObjectPath(
  companyId: string,
  jobId: string,
  fileNamePart: string
): string {
  const base =
    String(fileNamePart)
      .replace(/^.*[\\/]/, "")
      .replace(/\s+/g, " ")
      .trim() || "photo";
  const safe = base.replace(/[\\/]/g, "_");
  return `companies/${companyId}/jobs/${jobId}/photos/${safe}`;
}

/**
 * Složky zakázky: companies/{companyId}/jobs/{jobId}/folders/{folderId}/images/{file}
 */
/**
 * Přílohy nákladů: companies/{companyId}/jobs/{jobId}/expenses/{file}
 */
export function buildJobExpenseStorageObjectPath(
  companyId: string,
  jobId: string,
  fileNamePart: string
): string {
  const base =
    String(fileNamePart)
      .replace(/^.*[\\/]/, "")
      .replace(/\s+/g, " ")
      .trim() || "attachment";
  const safe = base.replace(/[\\/]/g, "_");
  return `companies/${companyId}/jobs/${jobId}/expenses/${safe}`;
}

/** Podklady výroby: companies/{companyId}/production/{productionId}/attachments/... */
export function buildProductionAttachmentStorageObjectPath(
  companyId: string,
  productionId: string,
  fileNamePart: string
): string {
  const base =
    String(fileNamePart)
      .replace(/^.*[\\/]/, "")
      .replace(/\s+/g, " ")
      .trim() || "file";
  const safe = base.replace(/[\\/]/g, "_");
  const stamp = Date.now();
  return `companies/${companyId}/production/${productionId}/attachments/${stamp}_${safe}`;
}

export function buildJobFolderImageStorageObjectPath(
  companyId: string,
  jobId: string,
  folderId: string,
  fileNamePart: string
): string {
  const base =
    String(fileNamePart)
      .replace(/^.*[\\/]/, "")
      .replace(/\s+/g, " ")
      .trim() || "photo";
  const safe = base.replace(/[\\/]/g, "_");
  return `companies/${companyId}/jobs/${jobId}/folders/${folderId}/images/${safe}`;
}

function logDebug(step: string, data?: Record<string, unknown>) {
  if (!DEBUG_JOB_PHOTO) return;
  console.log(`[JobPhotoUpload] ${step}`, data ?? "");
}

/**
 * Nahrání souboru (výběr z disku / fotoaparátu) — stejná funkce pro „Nahrát fotku“ i „Vyfotit“.
 */
export async function uploadJobPhotoFileViaFirebaseSdk(
  file: File,
  companyId: string,
  jobId: string
): Promise<{
  storagePath: string;
  resolvedFullPath: string;
  downloadURL: string;
  uploadResult: UploadResult;
}> {
  const safeBaseName =
    file.name.replace(/^.*[\\/]/, "").replace(/\s+/g, " ").trim() || "photo";
  const storagePath = buildJobPhotoStorageObjectPath(
    companyId,
    jobId,
    `${Date.now()}-${safeBaseName}`
  );

  logDebug("firebase storageBucket (z NEXT_PUBLIC_*)", {
    storageBucket: firebaseConfig.storageBucket || "(prázdné — mělo by být v initializeApp)",
  });
  logDebug("context", { companyId, jobId });
  logDebug("selected file", {
    name: file.name,
    size: file.size,
    type: file.type,
  });
  logDebug("generated storage path", { storagePath });
  logDebug("upload start");

  const storage = getFirebaseStorage();
  const storageRef = ref(storage, storagePath);

  const uploadResult = await promiseWithTimeout(
    uploadBytes(storageRef, file),
    JOB_PHOTO_UPLOAD_BYTES_TIMEOUT_MS,
    "Nahrávání souboru do Firebase Storage"
  );

  logDebug("upload success (uploadBytes)", {
    hasRef: !!uploadResult?.ref,
    refFullPath: uploadResult?.ref?.fullPath,
  });

  if (!uploadResult?.ref) {
    throw new Error(
      "Upload skončil bez platné reference do úložiště (uploadBytes nevrátil ref)."
    );
  }

  const resolvedFullPath =
    typeof uploadResult.ref.fullPath === "string" &&
    uploadResult.ref.fullPath.length > 0
      ? uploadResult.ref.fullPath
      : storagePath;

  const downloadURL = await promiseWithTimeout(
    getDownloadURL(uploadResult.ref),
    JOB_PHOTO_DOWNLOAD_URL_TIMEOUT_MS,
    "Získání download URL z Firebase Storage"
  );

  if (typeof downloadURL !== "string" || !downloadURL.trim()) {
    throw new Error(
      "Úložiště nevrátilo platnou adresu ke stažení (download URL)."
    );
  }

  logDebug("downloadURL", { downloadURL: downloadURL.trim() });

  return {
    storagePath,
    resolvedFullPath,
    downloadURL: downloadURL.trim(),
    uploadResult,
  };
}

/** Nahrání přílohy nákladu (foto / PDF). */
export async function uploadJobExpenseFileViaFirebaseSdk(
  file: File,
  companyId: string,
  jobId: string
): Promise<{
  storagePath: string;
  resolvedFullPath: string;
  downloadURL: string;
  uploadResult: UploadResult;
}> {
  const safeBaseName =
    file.name.replace(/^.*[\\/]/, "").replace(/\s+/g, " ").trim() || "attachment";
  const storagePath = buildJobExpenseStorageObjectPath(
    companyId,
    jobId,
    `${Date.now()}-${safeBaseName}`
  );

  logDebug("expense attachment upload", { companyId, jobId, storagePath });

  const storage = getFirebaseStorage();
  const storageRef = ref(storage, storagePath);

  const uploadResult = await promiseWithTimeout(
    uploadBytes(storageRef, file),
    JOB_PHOTO_UPLOAD_BYTES_TIMEOUT_MS,
    "Nahrávání přílohy nákladu do Firebase Storage"
  );

  if (!uploadResult?.ref) {
    throw new Error(
      "Upload přílohy skončil bez platné reference do úložiště."
    );
  }

  const resolvedFullPath =
    typeof uploadResult.ref.fullPath === "string" &&
    uploadResult.ref.fullPath.length > 0
      ? uploadResult.ref.fullPath
      : storagePath;

  const downloadURL = await promiseWithTimeout(
    getDownloadURL(uploadResult.ref),
    JOB_PHOTO_DOWNLOAD_URL_TIMEOUT_MS,
    "Získání download URL (náklad)"
  );

  if (typeof downloadURL !== "string" || !downloadURL.trim()) {
    throw new Error("Úložiště nevrátilo platnou adresu ke stažení.");
  }

  return {
    storagePath,
    resolvedFullPath,
    downloadURL: downloadURL.trim(),
    uploadResult,
  };
}

export async function uploadJobFolderImageFileViaFirebaseSdk(
  file: File,
  companyId: string,
  jobId: string,
  folderId: string
): Promise<{
  storagePath: string;
  resolvedFullPath: string;
  downloadURL: string;
  uploadResult: UploadResult;
}> {
  const safeBaseName =
    file.name.replace(/^.*[\\/]/, "").replace(/\s+/g, " ").trim() || "photo";
  const storagePath = buildJobFolderImageStorageObjectPath(
    companyId,
    jobId,
    folderId,
    `${Date.now()}-${safeBaseName}`
  );

  logDebug("folder image upload", { companyId, jobId, folderId, storagePath });

  const storage = getFirebaseStorage();
  const storageRef = ref(storage, storagePath);

  const uploadResult = await promiseWithTimeout(
    uploadBytes(storageRef, file),
    JOB_PHOTO_UPLOAD_BYTES_TIMEOUT_MS,
    "Nahrávání souboru do Firebase Storage (složka)"
  );

  if (!uploadResult?.ref) {
    throw new Error(
      "Upload skončil bez platné reference do úložiště (složka zakázky)."
    );
  }

  const resolvedFullPath =
    typeof uploadResult.ref.fullPath === "string" &&
    uploadResult.ref.fullPath.length > 0
      ? uploadResult.ref.fullPath
      : storagePath;

  const downloadURL = await promiseWithTimeout(
    getDownloadURL(uploadResult.ref),
    JOB_PHOTO_DOWNLOAD_URL_TIMEOUT_MS,
    "Získání download URL (složka zakázky)"
  );

  if (typeof downloadURL !== "string" || !downloadURL.trim()) {
    throw new Error("Úložiště nevrátilo platnou adresu ke stažení.");
  }

  return {
    storagePath,
    resolvedFullPath,
    downloadURL: downloadURL.trim(),
    uploadResult,
  };
}

/**
 * Nahrání blobu (např. export anotované fotky) na stejnou větev paths jako běžné fotky.
 */
export async function uploadJobPhotoBlobViaFirebaseSdk(
  blob: Blob,
  companyId: string,
  jobId: string,
  objectFileName: string,
  contentType = "image/png"
): Promise<{ storagePath: string; downloadURL: string }> {
  const storagePath = buildJobPhotoStorageObjectPath(
    companyId,
    jobId,
    objectFileName
  );
  logDebug("blob upload", { storagePath, contentType });

  const storage = getFirebaseStorage();
  const storageRef = ref(storage, storagePath);

  await promiseWithTimeout(
    uploadBytes(storageRef, blob, { contentType }),
    JOB_PHOTO_UPLOAD_BYTES_TIMEOUT_MS,
    "Nahrání anotované fotografie do Firebase Storage"
  );

  const downloadURL = await promiseWithTimeout(
    getDownloadURL(storageRef),
    JOB_PHOTO_DOWNLOAD_URL_TIMEOUT_MS,
    "Získání URL anotované fotografie"
  );

  if (typeof downloadURL !== "string" || !downloadURL.trim()) {
    throw new Error("Úložiště nevrátilo platnou URL pro anotovanou fotku.");
  }

  return { storagePath, downloadURL: downloadURL.trim() };
}

export async function uploadJobFolderImageBlobViaFirebaseSdk(
  blob: Blob,
  companyId: string,
  jobId: string,
  folderId: string,
  objectFileName: string,
  contentType = "image/png"
): Promise<{ storagePath: string; downloadURL: string }> {
  const storagePath = buildJobFolderImageStorageObjectPath(
    companyId,
    jobId,
    folderId,
    objectFileName
  );
  logDebug("folder blob upload", { storagePath, contentType, folderId });

  const storage = getFirebaseStorage();
  const storageRef = ref(storage, storagePath);

  await promiseWithTimeout(
    uploadBytes(storageRef, blob, { contentType }),
    JOB_PHOTO_UPLOAD_BYTES_TIMEOUT_MS,
    "Nahrání anotované fotografie (složka)"
  );

  const downloadURL = await promiseWithTimeout(
    getDownloadURL(storageRef),
    JOB_PHOTO_DOWNLOAD_URL_TIMEOUT_MS,
    "Získání URL anotované fotografie (složka)"
  );

  if (typeof downloadURL !== "string" || !downloadURL.trim()) {
    throw new Error("Úložiště nevrátilo platnou URL pro anotovanou fotku (složka).");
  }

  return { storagePath, downloadURL: downloadURL.trim() };
}

/**
 * Foto zaměření (před / mimo konkrétní jobs/{jobId}/photos).
 * companies/{companyId}/measurement_photos/{photoDocId}/{timestamp}-{filename}
 */
export function buildMeasurementPhotoStorageObjectPath(
  companyId: string,
  photoDocId: string,
  fileNamePart: string
): string {
  const base =
    String(fileNamePart)
      .replace(/^.*[\\/]/, "")
      .replace(/\s+/g, " ")
      .trim() || "photo";
  const safe = base.replace(/[\\/]/g, "_");
  return `companies/${companyId}/measurement_photos/${photoDocId}/${Date.now()}-${safe}`;
}

export async function uploadMeasurementPhotoFileViaFirebaseSdk(
  file: File,
  companyId: string,
  photoDocId: string
): Promise<{
  storagePath: string;
  resolvedFullPath: string;
  downloadURL: string;
  uploadResult: UploadResult;
}> {
  const safeBaseName =
    file.name.replace(/^.*[\\/]/, "").replace(/\s+/g, " ").trim() || "photo";
  const storagePath = buildMeasurementPhotoStorageObjectPath(
    companyId,
    photoDocId,
    safeBaseName
  );

  const storage = getFirebaseStorage();
  const storageRef = ref(storage, storagePath);

  const uploadResult = await promiseWithTimeout(
    uploadBytes(storageRef, file),
    JOB_PHOTO_UPLOAD_BYTES_TIMEOUT_MS,
    "Nahrávání foto zaměření do Firebase Storage"
  );

  if (!uploadResult?.ref) {
    throw new Error("Upload foto zaměření skončil bez platné reference.");
  }

  const resolvedFullPath =
    typeof uploadResult.ref.fullPath === "string" &&
    uploadResult.ref.fullPath.length > 0
      ? uploadResult.ref.fullPath
      : storagePath;

  const downloadURL = await promiseWithTimeout(
    getDownloadURL(uploadResult.ref),
    JOB_PHOTO_DOWNLOAD_URL_TIMEOUT_MS,
    "Získání download URL (foto zaměření)"
  );

  if (typeof downloadURL !== "string" || !downloadURL.trim()) {
    throw new Error("Úložiště nevrátilo platnou adresu ke stažení.");
  }

  return {
    storagePath,
    resolvedFullPath,
    downloadURL: downloadURL.trim(),
    uploadResult,
  };
}

export async function uploadMeasurementPhotoBlobViaFirebaseSdk(
  blob: Blob,
  companyId: string,
  photoDocId: string,
  objectFileName: string,
  contentType = "image/png"
): Promise<{ storagePath: string; downloadURL: string }> {
  const storagePath = buildMeasurementPhotoStorageObjectPath(
    companyId,
    photoDocId,
    objectFileName
  );

  const storage = getFirebaseStorage();
  const storageRef = ref(storage, storagePath);

  await promiseWithTimeout(
    uploadBytes(storageRef, blob, { contentType }),
    JOB_PHOTO_UPLOAD_BYTES_TIMEOUT_MS,
    "Nahrání anotovaného foto zaměření"
  );

  const downloadURL = await promiseWithTimeout(
    getDownloadURL(storageRef),
    JOB_PHOTO_DOWNLOAD_URL_TIMEOUT_MS,
    "Získání URL anotovaného foto zaměření"
  );

  if (typeof downloadURL !== "string" || !downloadURL.trim()) {
    throw new Error("Úložiště nevrátilo platnou URL pro anotované foto zaměření.");
  }

  return { storagePath, downloadURL: downloadURL.trim() };
}
