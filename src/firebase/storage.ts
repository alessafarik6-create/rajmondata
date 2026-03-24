"use client";

import { getStorage, type FirebaseStorage } from "firebase/storage";
import { initializeFirebase } from "./init";

let cached: FirebaseStorage | null = null;

/**
 * Vrací skutečnou instanci Firebase Storage (stejná jako `getStorage(app)`).
 *
 * Důležité: nepoužívejte Proxy ani „falešný“ objekt — funkce `ref()` z
 * `firebase/storage` uvnitř SDK očekává pravý `FirebaseStorage`. S Proxy
 * může SDK narazit na `undefined` a spadnout na `Cannot read properties of
 * undefined (reading 'path')` při vytváření reference.
 */
export function getFirebaseStorage(): FirebaseStorage {
  if (!cached) {
    const { firebaseApp } = initializeFirebase();
    cached = getStorage(firebaseApp);
  }
  return cached;
}
