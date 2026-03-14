'use client';

import React, { type ReactNode, useEffect, useState } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from './init';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

/**
 * Komponenta zajišťující, že Firebase je inicializována pouze na straně klienta.
 * Tím se předchází chybám při SSR (Server-Side Rendering).
 */
export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  // Služby ukládáme do stavu, výchozí hodnota je null pro bezpečnost SSR
  const [firebaseServices, setFirebaseServices] = useState<ReturnType<typeof initializeFirebase> | null>(null);

  useEffect(() => {
    // Tento efekt se spustí pouze v prohlížeči po prvním vykreslení.
    setFirebaseServices(initializeFirebase());
  }, []);

  // Během SSR a do momentu, než je klient připraven, vracíme loading stav.
  // To zabrání tomu, aby se podstránky pokoušely volat useFirebase() na serveru.
  if (!firebaseServices) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <FirebaseProvider
      firebaseApp={firebaseServices.firebaseApp}
      auth={firebaseServices.auth}
      firestore={firebaseServices.firestore}
    >
      {children}
    </FirebaseProvider>
  );
}
