'use client';

import React, { type ReactNode, useEffect, useState } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from './init';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

/**
 * Component ensuring Firebase is initialized only on the client side.
 * Wraps children in the provider even during SSR to avoid context errors.
 */
export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const [firebaseServices, setFirebaseServices] = useState<ReturnType<typeof initializeFirebase> | null>(null);

  useEffect(() => {
    // Only initialize in browser after hydration
    setFirebaseServices(initializeFirebase());
  }, []);

  // Always render the Provider so that child hooks like useFirebase() 
  // find the context during SSR, preventing "missing provider" errors.
  return (
    <FirebaseProvider
      firebaseApp={firebaseServices?.firebaseApp ?? null}
      auth={firebaseServices?.auth ?? null}
      firestore={firebaseServices?.firestore ?? null}
    >
      {children}
    </FirebaseProvider>
  );
}
