"use client";

import { getStorage, type FirebaseStorage } from "firebase/storage";
import { initializeFirebase } from "./init";

let cached: FirebaseStorage | null = null;

function getStorageInstance(): FirebaseStorage {
  if (!cached) {
    const { firebaseApp } = initializeFirebase();
    cached = getStorage(firebaseApp);
  }
  return cached;
}

/**
 * Lazily initialized so importing this module does not run before env is valid
 * (same timing as FirebaseClientProvider).
 */
export const storage = new Proxy({} as FirebaseStorage, {
  get(_target, prop, receiver) {
    const inst = getStorageInstance();
    const value = Reflect.get(inst as object, prop, receiver);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(inst)
      : value;
  },
});
