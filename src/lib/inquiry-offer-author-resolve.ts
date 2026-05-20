import "server-only";

import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import {
  authorInitialsFromName,
  type InquiryOfferAuthorSnapshot,
} from "@/lib/inquiry-offer-footer";

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}

/** Pole s hotovou HTTP URL fotky (priorita shora dolů). */
const PROFILE_PHOTO_URL_FIELDS = [
  "photoURL",
  "photoUrl",
  "avatarUrl",
  "profilePhotoUrl",
  "profileImageUrl",
  "imageUrl",
  "employeePhotoUrl",
  "userPhotoUrl",
  "profileImage",
] as const;

/** Pole s cestou ve Firebase Storage. */
const PROFILE_PHOTO_STORAGE_FIELDS = [
  "photoStoragePath",
  "profilePhotoStoragePath",
  "profileImageStoragePath",
  "avatarStoragePath",
  "employeePhotoStoragePath",
  "photoPath",
  "storagePath",
] as const;

export type ProfilePhotoCandidate = {
  httpUrl: string | null;
  storagePath: string | null;
};

export function pickProfilePhotoCandidate(
  doc: Record<string, unknown> | null | undefined
): ProfilePhotoCandidate {
  const d = doc ?? {};
  for (const key of PROFILE_PHOTO_URL_FIELDS) {
    const raw = strOrNull(d[key]);
    if (!raw) continue;
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return { httpUrl: raw, storagePath: null };
    }
    if (raw.startsWith("gs://")) {
      const path = raw.replace(/^gs:\/\/[^/]+\//, "").trim();
      if (path) return { httpUrl: null, storagePath: path };
    }
    if (!raw.includes("://") && raw.length > 3) {
      return { httpUrl: null, storagePath: raw };
    }
  }
  for (const key of PROFILE_PHOTO_STORAGE_FIELDS) {
    const path = strOrNull(d[key]);
    if (path) return { httpUrl: null, storagePath: path };
  }
  return { httpUrl: null, storagePath: null };
}

function storageDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  const enc = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${enc}?alt=media&token=${encodeURIComponent(token)}`;
}

export async function resolveStoragePathToDownloadUrl(
  storagePath: string
): Promise<string | null> {
  const path = storagePath.trim().replace(/^\//, "");
  if (!path) return null;
  const bucket = getAdminStorageBucket();
  if (!bucket) return null;
  try {
    const file = bucket.file(path);
    const [meta] = await file.getMetadata();
    const rawToken = meta.metadata?.firebaseStorageDownloadTokens;
    const token =
      typeof rawToken === "string" ? rawToken.split(",")[0]?.trim() : null;
    if (token) {
      return storageDownloadUrl(bucket.name, path, token);
    }
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    return typeof signedUrl === "string" ? signedUrl : null;
  } catch {
    return null;
  }
}

async function resolvePhotoCandidate(
  candidate: ProfilePhotoCandidate
): Promise<string | null> {
  if (candidate.httpUrl) return candidate.httpUrl;
  if (candidate.storagePath) {
    return await resolveStoragePathToDownloadUrl(candidate.storagePath);
  }
  return null;
}

async function resolveFirstPhotoUrl(
  ...docs: Array<Record<string, unknown> | null | undefined>
): Promise<string | null> {
  for (const doc of docs) {
    const c = pickProfilePhotoCandidate(doc);
    const url = await resolvePhotoCandidate(c);
    if (url) return url;
  }
  return null;
}

function displayNameFromDocs(
  ...docs: Array<Record<string, unknown> | null | undefined>
): string | null {
  for (const d of docs) {
    const doc = d ?? {};
    const direct = strOrNull(doc.displayName) ?? strOrNull(doc.name);
    if (direct) return direct;
    const fn = strOrNull(doc.firstName);
    const ln = strOrNull(doc.lastName);
    const full = [fn, ln].filter(Boolean).join(" ").trim();
    if (full) return full;
  }
  return null;
}

async function loadEmployeeDocForUser(
  db: Firestore,
  companyId: string,
  userId: string,
  userDoc: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const employeeId = strOrNull(userDoc.employeeId);
  const employeesCol = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("employees");

  if (employeeId) {
    const snap = await employeesCol.doc(employeeId).get();
    if (snap.exists) return (snap.data() ?? {}) as Record<string, unknown>;
  }

  const byAuth = await employeesCol.where("authUserId", "==", userId).limit(1).get();
  if (!byAuth.empty) {
    return (byAuth.docs[0]!.data() ?? {}) as Record<string, unknown>;
  }

  const email = strOrNull(userDoc.email)?.toLowerCase();
  if (email) {
    const byEmail = await employeesCol.where("email", "==", email).limit(3).get();
    for (const doc of byEmail.docs) {
      const data = doc.data() as Record<string, unknown>;
      const authUid = strOrNull(data.authUserId);
      if (!authUid || authUid === userId) return data;
    }
  }

  return null;
}

/**
 * Načte autora nabídky (users + employees + Auth) a vyřeší platnou URL fotky.
 */
export async function resolveInquiryOfferAuthor(params: {
  db: Firestore;
  auth: Auth | null;
  companyId: string;
  userId: string;
}): Promise<InquiryOfferAuthorSnapshot> {
  const { db, auth, companyId, userId } = params;

  const userSnap = await db.collection("users").doc(userId).get();
  const userDoc = (userSnap.data() ?? {}) as Record<string, unknown>;

  let employeeDoc: Record<string, unknown> | null = null;
  const orgId =
    strOrNull(userDoc.companyId) ??
    strOrNull(userDoc.organizationId) ??
    companyId;
  if (orgId && orgId === companyId) {
    try {
      employeeDoc = await loadEmployeeDocForUser(db, companyId, userId, userDoc);
    } catch {
      employeeDoc = null;
    }
  }

  let authPhoto: string | null = null;
  let authDisplayName: string | null = null;
  if (auth) {
    try {
      const authUser = await auth.getUser(userId);
      authPhoto = strOrNull(authUser.photoURL);
      authDisplayName = strOrNull(authUser.displayName);
    } catch {
      /* Auth profil není povinný */
    }
  }

  const photoUrl = await resolveFirstPhotoUrl(
    employeeDoc,
    userDoc,
    authPhoto ? { photoURL: authPhoto } : null
  );

  const displayName =
    displayNameFromDocs(employeeDoc, userDoc, authDisplayName ? { displayName: authDisplayName } : null) ??
    null;

  const email =
    strOrNull(userDoc.email) ??
    strOrNull(employeeDoc?.email) ??
    null;

  const phone =
    strOrNull(userDoc.phone) ??
    strOrNull(userDoc.phoneNumber) ??
    strOrNull(employeeDoc?.phone) ??
    strOrNull(employeeDoc?.phoneNumber) ??
    null;

  const jobTitle =
    strOrNull(userDoc.jobTitle) ??
    strOrNull(userDoc.position) ??
    strOrNull(employeeDoc?.jobTitle) ??
    strOrNull(employeeDoc?.position) ??
    null;

  return {
    uid: userId,
    displayName,
    email,
    phone,
    jobTitle,
    photoUrl,
    initials: authorInitialsFromName(displayName),
  };
}

/** Pole pro historii nabídky (snímek autora při odeslání). */
export function buildInquiryOfferAuthorHistoryFields(author: InquiryOfferAuthorSnapshot) {
  return {
    authorId: author.uid,
    authorName: author.displayName,
    authorEmail: author.email,
    authorPhotoUrl: author.photoUrl,
  };
}
