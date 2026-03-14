'use client';

import React, { useState, useEffect, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const [firebaseServices, setFirebaseServices] = useState<any>(null);

  useEffect(() => {
    // Inicializace Firebase proběhne pouze na straně klienta po hydrataci.
    // Tím se vyhneme chybám 500 při pokusu o přístup k browser API na serveru.
    setFirebaseServices(initializeFirebase());
  }, []);

  if (!firebaseServices) {
    // Během SSR a do okamžiku hydratace zobrazíme loading stav.
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
