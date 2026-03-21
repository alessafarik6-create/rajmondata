"use client";

import { firebaseClientEnvReady, firebaseConfig } from "@/firebase/config";
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator } from "firebase/firestore";
import { shouldConnectFirebaseEmulators } from "@/lib/firebase-client-env";

/**
 * Initializes the Firebase Client SDKs.
 */
export function initializeFirebase() {
  if (!firebaseClientEnvReady) {
    throw new Error(
      "Firebase client env incomplete: set NEXT_PUBLIC_FIREBASE_* in .env.local (see .env.example)."
    );
  }

  if (!getApps().length) {
    const firebaseApp = initializeApp(firebaseConfig);
    return getSdks(firebaseApp);
  }

  return getSdks(getApp());
}

export function getSdks(firebaseApp: FirebaseApp) {
  const auth = getAuth(firebaseApp);
  const firestore = getFirestore(firebaseApp);

  if (typeof window !== "undefined") {
    setPersistence(auth, browserLocalPersistence).catch((err) => {
      console.error("Firebase persistence error:", err);
    });
  }

  const useEmulators = shouldConnectFirebaseEmulators();

  if (useEmulators && typeof window !== "undefined") {
    try {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", {
        disableWarnings: true,
      });
    } catch (e) {
      console.warn(
        "[firebase] connectAuthEmulator failed (already connected or emulator down):",
        e
      );
    }

    try {
      connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
    } catch (e) {
      console.warn(
        "[firebase] connectFirestoreEmulator failed (already connected or emulator down):",
        e
      );
    }
  }

  return {
    firebaseApp,
    auth,
    firestore,
  };
}
