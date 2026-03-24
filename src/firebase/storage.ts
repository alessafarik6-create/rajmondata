"use client";

import { getStorage, type FirebaseStorage } from "firebase/storage";
import { firebaseConfig } from "./config";
import { initializeFirebase } from "./init";

let cached: FirebaseStorage | null = null;

/**
 * Jednoznačná gs:// URL pro `getStorage(app, bucketUrl)` — musí odpovídat
 * bucketu v Firebase Console a v NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.
 */
function storageBucketGsUrl(): string | null {
  const raw = firebaseConfig.storageBucket?.trim();
  if (!raw) return null;
  if (raw.startsWith("gs://")) return raw;
  return `gs://${raw}`;
}

/**
 * Vrací skutečnou instanci Firebase Storage.
 *
 * Explicitně předáváme bucket z `firebaseConfig`, aby SDK nemířilo na
 * nesprávný výchozí bucket (např. po změně .env), což může vést k podivným
 * chybám sítě / CORS u firebasestorage.googleapis.com.
 *
 * Nepoužívejte Proxy kolem instance — `ref()` vyžaduje pravý objekt.
 */
export function getFirebaseStorage(): FirebaseStorage {
  if (!cached) {
    const { firebaseApp } = initializeFirebase();
    const gs = storageBucketGsUrl();
    cached = gs ? getStorage(firebaseApp, gs) : getStorage(firebaseApp);
  }
  return cached;
}
