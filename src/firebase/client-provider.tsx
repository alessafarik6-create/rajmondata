"use client";

import React, { type ReactNode, useMemo } from "react";
import { FirebaseProvider } from "@/firebase/provider";
import { initializeFirebase } from "./init";
import { firebaseClientEnvReady } from "@/firebase/config";
import { getFirebaseClientEnvUserMessage } from "@/lib/firebase-client-env";

interface FirebaseClientProviderProps {
  children: ReactNode;
}

/**
 * Client-side Firebase bootstrap.
 * Initializes Firebase synchronously on the client so auth is available
 * immediately after hydration and survives mobile redirects more reliably.
 */
export function FirebaseClientProvider({
  children,
}: FirebaseClientProviderProps) {
  const firebaseConfigError = firebaseClientEnvReady
    ? null
    : getFirebaseClientEnvUserMessage();

  const firebaseServices = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    if (!firebaseClientEnvReady) {
      return null;
    }

    try {
      return initializeFirebase();
    } catch (error) {
      console.error("[FirebaseClientProvider] initializeFirebase failed:", error);
      return null;
    }
  }, []);

  return (
    <FirebaseProvider
      firebaseApp={firebaseServices?.firebaseApp ?? null}
      auth={firebaseServices?.auth ?? null}
      firestore={firebaseServices?.firestore ?? null}
      firebaseConfigError={firebaseConfigError}
    >
      {children}
    </FirebaseProvider>
  );
}