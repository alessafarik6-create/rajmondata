"use client";

import { getStorage, type FirebaseStorage } from "firebase/storage";
import { initializeFirebase } from "./init";

let cached: FirebaseStorage | null = null;

/**
 * Vrací instanci Firebase Storage pro stejnou aplikaci jako Auth/Firestore.
 *
 * Používá výhradně `getStorage(firebaseApp)` — bucket se bere z `storageBucket`
 * v `initializeApp(firebaseConfig)` (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET).
 * Druhý argument `getStorage(app, gs://…)` umí při nesouladu s konfigurací aplikace
 * vést k volání nesprávného bucketu a v prohlížeči to často vypadá jako CORS u
 * firebasestorage.googleapis.com.
 *
 * Nepoužívejte Proxy kolem instance — `ref()` vyžaduje pravý objekt.
 */
export function getFirebaseStorage(): FirebaseStorage {
  if (!cached) {
    const { firebaseApp } = initializeFirebase();
    cached = getStorage(firebaseApp);
  }
  return cached;
}
