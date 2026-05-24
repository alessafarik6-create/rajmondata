import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import {
  companyDocumentIdForJobFolderImage,
  companyDocumentIdForJobLegacyPhoto,
  JOB_MEDIA_DOCUMENT_SOURCE,
} from "@/lib/job-linked-document-sync";
import {
  inferJobMediaItemType,
  type JobFolderType,
  type JobMediaFileType,
} from "@/lib/job-media-types";
import {
  buildJobFolderImageStorageObjectPath,
  buildJobPhotoStorageObjectPath,
} from "@/lib/job-photo-upload";
import {
  listItemFromFirestoreRow,
  type JobMediaImportListItem,
  type JobMediaImportSelectionRef,
} from "@/lib/job-media-import-types";

const FIRESTORE_DENY = new Set([
  "id",
  "jobId",
  "folderId",
  "companyId",
  "createdAt",
  "updatedAt",
  "createdBy",
  "imageUrl",
  "url",
  "downloadURL",
  "originalImageUrl",
  "annotatedImageUrl",
  "storagePath",
  "annotatedStoragePath",
  "path",
  "fullPath",
  "fileUrl",
  "ledgerKind",
  "ledgerExpenseId",
  "ledgerFinanceId",
  "ledgerAmountNet",
  "ledgerAmountGross",
  "ledgerDate",
  "requiresCustomerApproval",
  "approvalStatus",
  "approvalNoteFromAdmin",
  "approvalRequestedAt",
  "approvalRequestedBy",
  "approvedAt",
  "approvedBy",
  "customerComment",
  "customerCommentAt",
  "customerCommentBy",
]);

function storageDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  const enc = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${enc}?alt=media&token=${encodeURIComponent(token)}`;
}

async function copyStorageToNewPath(
  srcPath: string,
  destPath: string
): Promise<string | null> {
  const bucket = getAdminStorageBucket();
  if (!bucket) return null;
  const src = String(srcPath).trim().replace(/^\//, "");
  const dest = String(destPath).trim().replace(/^\//, "");
  if (!src || !dest) return null;
  try {
    const srcFile = bucket.file(src);
    const destFile = bucket.file(dest);
    const [exists] = await srcFile.exists();
    if (!exists) return null;
    await srcFile.copy(destFile);
    const [meta] = await destFile.getMetadata();
    const rawToken = meta.metadata?.firebaseStorageDownloadTokens;
    const token =
      typeof rawToken === "string" ? rawToken.split(",")[0]?.trim() : null;
    if (token) {
      return storageDownloadUrl(bucket.name, dest, token);
    }
    const [signedUrl] = await destFile.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    return typeof signedUrl === "string" ? signedUrl : null;
  } catch {
    return null;
  }
}

function pickCopyableFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (FIRESTORE_DENY.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function folderKey(type: JobFolderType | undefined, name: string): string {
  return `${type ?? "files"}::${name.trim() || "Složka"}`;
}

function todayIsoDate(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

function adminMirrorDoc(params: {
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  imageId: string;
  userId: string;
  fileName: string;
  fileType: JobMediaFileType;
  mimeType?: string | null;
  fileUrl: string;
  storagePath: string | null;
  note: string | null;
  folderId?: string;
  kind: "folderImage" | "legacyPhoto";
}): Record<string, unknown> {
  const note = params.note?.trim() ? params.note.trim() : null;
  const jn = params.jobDisplayName?.trim() ?? "";
  const fn = params.fileName.trim() || "soubor";
  const ts = FieldValue.serverTimestamp();
  return {
    type: "received",
    documentKind: "prijate",
    source: JOB_MEDIA_DOCUMENT_SOURCE,
    sourceType: "job",
    sourceId: params.imageId,
    jobLinkedKind: params.kind,
    ...(params.folderId ? { folderId: params.folderId } : {}),
    jobId: params.jobId,
    jobName: jn || null,
    number: fn.slice(0, 120),
    entityName: jn || "Zakázka",
    description: note ?? fn,
    note,
    date: todayIsoDate(),
    fileUrl: params.fileUrl,
    fileType: params.fileType,
    mimeType: params.mimeType?.trim() || null,
    fileName: fn,
    storagePath: params.storagePath,
    vat: 0,
    organizationId: params.companyId,
    createdBy: params.userId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export async function listJobMediaForImport(
  db: Firestore,
  companyId: string,
  sourceJobId: string
): Promise<JobMediaImportListItem[]> {
  const jobRef = db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .doc(sourceJobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    throw new Error("Zdrojová zakázka neexistuje.");
  }

  const out: JobMediaImportListItem[] = [];

  const foldersSnap = await jobRef.collection("folders").get();
  const folderMeta = new Map<
    string,
    { name: string; type: JobFolderType | undefined }
  >();
  for (const f of foldersSnap.docs) {
    const d = f.data() as Record<string, unknown>;
    folderMeta.set(f.id, {
      name: String(d.name ?? "Složka").trim() || "Složka",
      type: (d.type as JobFolderType | undefined) ?? "files",
    });
    const imagesSnap = await f.ref.collection("images").get();
    for (const img of imagesSnap.docs) {
      const meta = folderMeta.get(f.id)!;
      out.push(
        listItemFromFirestoreRow({
          kind: "folderImage",
          id: img.id,
          row: { ...img.data(), id: img.id },
          folderId: f.id,
          folderName: meta.name,
          folderType: meta.type,
        })
      );
    }
  }

  const photosSnap = await jobRef.collection("photos").get();
  for (const p of photosSnap.docs) {
    out.push(
      listItemFromFirestoreRow({
        kind: "legacyPhoto",
        id: p.id,
        row: { ...p.data(), id: p.id },
      })
    );
  }

  out.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  return out;
}

async function ensureTargetFolder(
  db: Firestore,
  companyId: string,
  targetJobId: string,
  userId: string,
  sourceFolder: { name: string; type: JobFolderType | undefined; data: Record<string, unknown> },
  cache: Map<string, string>
): Promise<string> {
  const key = folderKey(sourceFolder.type, sourceFolder.name);
  const cached = cache.get(key);
  if (cached) return cached;

  const foldersCol = db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .doc(targetJobId)
    .collection("folders");

  const existing = await foldersCol.get();
  for (const f of existing.docs) {
    const d = f.data() as Record<string, unknown>;
    const name = String(d.name ?? "").trim() || "Složka";
    const type = (d.type as JobFolderType | undefined) ?? "files";
    if (folderKey(type, name) === key) {
      cache.set(key, f.id);
      return f.id;
    }
  }

  const newRef = foldersCol.doc();
  const folderData = pickCopyableFields(sourceFolder.data);
  await newRef.set({
    ...folderData,
    id: newRef.id,
    name: sourceFolder.name,
    type: sourceFolder.type ?? "files",
    companyId,
    jobId: targetJobId,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: userId,
  });
  cache.set(key, newRef.id);
  return newRef.id;
}

export async function copyJobMediaFromSourceJob(params: {
  db: Firestore;
  companyId: string;
  sourceJobId: string;
  targetJobId: string;
  userId: string;
  jobDisplayName: string | null;
  items: JobMediaImportSelectionRef[];
}): Promise<{ copied: number; failed: string[] }> {
  const { db, companyId, sourceJobId, targetJobId, userId, jobDisplayName, items } =
    params;

  if (sourceJobId === targetJobId) {
    throw new Error("Nelze importovat ze stejné zakázky.");
  }

  const sourceJobRef = db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .doc(sourceJobId);
  const targetJobRef = db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .doc(targetJobId);

  const [sourceJobSnap, targetJobSnap] = await Promise.all([
    sourceJobRef.get(),
    targetJobRef.get(),
  ]);
  if (!sourceJobSnap.exists || !targetJobSnap.exists) {
    throw new Error("Zakázka neexistuje.");
  }

  const folderCache = new Map<string, string>();
  const idMap = new Map<string, string>();
  let copied = 0;
  const failed: string[] = [];

  const folderDocs = await sourceJobRef.collection("folders").get();
  const sourceFolderById = new Map<string, { name: string; type: JobFolderType | undefined; data: Record<string, unknown> }>();
  for (const f of folderDocs.docs) {
    const d = f.data() as Record<string, unknown>;
    sourceFolderById.set(f.id, {
      name: String(d.name ?? "Složka").trim() || "Složka",
      type: (d.type as JobFolderType | undefined) ?? "files",
      data: d,
    });
  }

  const sortedItems = [...items].sort((a, b) => {
    if (a.kind === b.kind) return 0;
    return a.kind === "legacyPhoto" ? 1 : -1;
  });

  for (const sel of sortedItems) {
    try {
      if (sel.kind === "legacyPhoto") {
        const srcDoc = await sourceJobRef.collection("photos").doc(sel.id).get();
        if (!srcDoc.exists) {
          failed.push(sel.id);
          continue;
        }
        const data = srcDoc.data() as Record<string, unknown>;
        const newRef = targetJobRef.collection("photos").doc();
        const fileName =
          String(data.fileName ?? data.name ?? "photo").trim() || "photo";
        const safeName = `${Date.now()}-import-${fileName.replace(/[\\/]/g, "_")}`;
        const storagePath = buildJobPhotoStorageObjectPath(
          companyId,
          targetJobId,
          safeName
        );
        const srcStorage =
          String(data.storagePath ?? data.path ?? "").trim() ||
          null;
        let downloadURL = "";
        if (srcStorage) {
          const url = await copyStorageToNewPath(srcStorage, storagePath);
          if (url) downloadURL = url;
        }
        if (!downloadURL) {
          downloadURL = String(
            data.imageUrl ?? data.url ?? data.downloadURL ?? ""
          ).trim();
        }

        let annotatedImageUrl: string | null = null;
        const annPath = String(data.annotatedStoragePath ?? "").trim();
        if (annPath) {
          const annDest = buildJobPhotoStorageObjectPath(
            companyId,
            targetJobId,
            `annotated-${safeName}`
          );
          const annUrl = await copyStorageToNewPath(annPath, annDest);
          if (annUrl) {
            annotatedImageUrl = annUrl;
          }
        } else if (typeof data.annotatedImageUrl === "string") {
          annotatedImageUrl = data.annotatedImageUrl.trim() || null;
        }

        const extra = pickCopyableFields(data);
        const fileType = inferJobMediaItemType(data);
        await newRef.set({
          ...extra,
          id: newRef.id,
          companyId,
          jobId: targetJobId,
          imageUrl: downloadURL || annotatedImageUrl || extra.imageUrl,
          url: downloadURL || annotatedImageUrl,
          downloadURL: downloadURL || annotatedImageUrl,
          originalImageUrl:
            downloadURL ||
            String(data.originalImageUrl ?? data.imageUrl ?? "").trim() ||
            null,
          annotatedImageUrl,
          storagePath: downloadURL ? storagePath : null,
          annotatedStoragePath: annPath
            ? buildJobPhotoStorageObjectPath(
                companyId,
                targetJobId,
                `annotated-${safeName}`
              )
            : null,
          fileName,
          name: fileName,
          fileType,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: userId,
          importedFromJobId: sourceJobId,
          importedFromMediaId: sel.id,
        });

        await db
          .collection("companies")
          .doc(companyId)
          .collection("documents")
          .doc(companyDocumentIdForJobLegacyPhoto(newRef.id))
          .set(
            adminMirrorDoc({
              companyId,
              jobId: targetJobId,
              jobDisplayName,
              imageId: newRef.id,
              userId,
              fileName,
              fileType,
              mimeType:
                typeof data.mimeType === "string" ? data.mimeType : null,
              fileUrl: annotatedImageUrl || downloadURL,
              storagePath: downloadURL ? storagePath : null,
              note: typeof data.note === "string" ? data.note : null,
              kind: "legacyPhoto",
            })
          );

        idMap.set(`legacy:${sel.id}`, newRef.id);
        copied += 1;
        continue;
      }

      const folderId = String(sel.folderId ?? "").trim();
      if (!folderId) {
        failed.push(sel.id);
        continue;
      }
      const folderInfo = sourceFolderById.get(folderId);
      if (!folderInfo) {
        failed.push(sel.id);
        continue;
      }

      const srcImg = await sourceJobRef
        .collection("folders")
        .doc(folderId)
        .collection("images")
        .doc(sel.id)
        .get();
      if (!srcImg.exists) {
        failed.push(sel.id);
        continue;
      }
      const data = srcImg.data() as Record<string, unknown>;
      const targetFolderId = await ensureTargetFolder(
        db,
        companyId,
        targetJobId,
        userId,
        folderInfo,
        folderCache
      );

      const newRef = targetJobRef
        .collection("folders")
        .doc(targetFolderId)
        .collection("images")
        .doc();

      const fileName =
        String(data.fileName ?? data.name ?? "file").trim() || "file";
      const safeName = `${Date.now()}-import-${fileName.replace(/[\\/]/g, "_")}`;
      const storagePath = buildJobFolderImageStorageObjectPath(
        companyId,
        targetJobId,
        targetFolderId,
        safeName
      );

      const srcStorage = String(data.storagePath ?? data.path ?? "").trim();
      let downloadURL = "";
      if (srcStorage) {
        const url = await copyStorageToNewPath(srcStorage, storagePath);
        if (url) downloadURL = url;
      }
      if (!downloadURL) {
        downloadURL = String(
          data.imageUrl ?? data.url ?? data.downloadURL ?? data.fileUrl ?? ""
        ).trim();
      }

      let annotatedImageUrl: string | null = null;
      let annotatedStoragePath: string | null = null;
      const annPath = String(data.annotatedStoragePath ?? "").trim();
      if (annPath) {
        annotatedStoragePath = buildJobFolderImageStorageObjectPath(
          companyId,
          targetJobId,
          targetFolderId,
          `annotated-${safeName}`
        );
        const annUrl = await copyStorageToNewPath(annPath, annotatedStoragePath);
        if (annUrl) annotatedImageUrl = annUrl;
      } else if (typeof data.annotatedImageUrl === "string") {
        annotatedImageUrl = data.annotatedImageUrl.trim() || null;
      }

      const extra = pickCopyableFields(data);
      const fileType = inferJobMediaItemType(data);
      let sourcePdfId = extra.sourcePdfId;
      if (typeof sourcePdfId === "string" && sourcePdfId.trim()) {
        const mapped = idMap.get(`folder:${sourcePdfId}`);
        if (mapped) sourcePdfId = mapped;
      }

      await newRef.set({
        ...extra,
        ...(sourcePdfId !== extra.sourcePdfId ? { sourcePdfId } : {}),
        id: newRef.id,
        companyId,
        jobId: targetJobId,
        folderId: targetFolderId,
        imageUrl: downloadURL || annotatedImageUrl,
        url: downloadURL || annotatedImageUrl,
        downloadURL: downloadURL || annotatedImageUrl,
        originalImageUrl:
          downloadURL ||
          String(data.originalImageUrl ?? "").trim() ||
          null,
        annotatedImageUrl,
        storagePath: downloadURL ? storagePath : null,
        annotatedStoragePath,
        path: downloadURL ? storagePath : null,
        fileName,
        name: fileName,
        fileType,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: userId,
        importedFromJobId: sourceJobId,
        importedFromMediaId: sel.id,
        importedFromFolderId: folderId,
      });

      await db
        .collection("companies")
        .doc(companyId)
        .collection("documents")
        .doc(companyDocumentIdForJobFolderImage(targetFolderId, newRef.id))
        .set(
          adminMirrorDoc({
            companyId,
            jobId: targetJobId,
            jobDisplayName,
            folderId: targetFolderId,
            imageId: newRef.id,
            userId,
            fileName,
            fileType,
            mimeType: typeof data.mimeType === "string" ? data.mimeType : null,
            fileUrl: annotatedImageUrl || downloadURL,
            storagePath: downloadURL ? storagePath : null,
            note: typeof data.note === "string" ? data.note : null,
            kind: "folderImage",
          })
        );

      idMap.set(`folder:${sel.id}`, newRef.id);
      copied += 1;
    } catch {
      failed.push(sel.id);
    }
  }

  return { copied, failed };
}
