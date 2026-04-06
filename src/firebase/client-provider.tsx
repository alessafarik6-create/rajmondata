"use client";

import React, { type ReactNode, useEffect, useMemo } from "react";
import { FirebaseProvider } from "@/firebase/provider";
import { initializeFirebase } from "./init";
import { firebaseClientEnvReady } from "@/firebase/config";
import { getFirebaseClientEnvUserMessage } from "@/lib/firebase-client-env";
import { PwaInstallProvider } from "@/components/pwa/pwa-install-context";
import { PortalNotificationsProvider } from "@/components/portal/portal-notifications-context";

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

  useEffect(() => {
    console.log("Firebase env check:", {
      apiKey: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: !!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: !!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: !!process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: !!process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  }, []);

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
      {/* PWA: stav instalace; banner je v layoutu po přihlášení (portál / admin). */}
      <PwaInstallProvider>
        <PortalNotificationsProvider>{children}</PortalNotificationsProvider>
      </PwaInstallProvider>
    </FirebaseProvider>
  );
}