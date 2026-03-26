'use client';

import React, { DependencyList, createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import { registerMemoFirebaseTarget } from '@/firebase/memo-firebase-registry';
import { FirebaseApp } from 'firebase/app';
import { Firestore } from 'firebase/firestore';
import { Auth, User, onAuthStateChanged } from 'firebase/auth';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { FirestoreIndexPendingProvider } from '@/firebase/firestore/firestore-index-pending-registry';
interface FirebaseProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  auth: Auth | null;
  /** Set when NEXT_PUBLIC_FIREBASE_* are missing — services stay null. */
  firebaseConfigError?: string | null;
}

// Internal state for user authentication
interface UserAuthState {
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

// Combined state for the Firebase context
export interface FirebaseContextState {
  areServicesAvailable: boolean; // True if core services (app, firestore, auth instance) are provided
  firebaseConfigError: string | null;
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  auth: Auth | null; // The Auth service instance
  // User authentication state
  user: User | null;
  isUserLoading: boolean; // True during initial auth check
  userError: Error | null; // Error from auth listener
}

// Return type for useFirebase()
export interface FirebaseServicesAndUser {
  areServicesAvailable: boolean;
  firebaseConfigError: string | null;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

// Return type for useUser() - specific to user auth state
export interface UserHookResult { 
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

// React Context
export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

/**
 * FirebaseProvider manages and provides Firebase services and user authentication state.
 */
export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  firebaseApp,
  firestore,
  auth,
  firebaseConfigError = null,
}) => {
  const [userAuthState, setUserAuthState] = useState<UserAuthState>({
    user: null,
    isUserLoading: true, // Start loading until first auth event
    userError: null,
  });

  // Effect to subscribe to Firebase auth state changes
  useEffect(() => {
    if (!auth) { 
      if (typeof window !== 'undefined') {
        setUserAuthState(prev => ({ ...prev, isUserLoading: false }));
      }
      return;
    }

    setUserAuthState({ user: null, isUserLoading: true, userError: null });

    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        setUserAuthState({ user: firebaseUser, isUserLoading: false, userError: null });
      },
      (error) => {
        console.error("FirebaseProvider: onAuthStateChanged error:", error);
        setUserAuthState({ user: null, isUserLoading: false, userError: error });
      }
    );
    return () => unsubscribe();
  }, [auth, firestore]);

  const contextValue = useMemo((): FirebaseContextState => {
    const servicesAvailable = !!(firebaseApp && firestore && auth);
    return {
      areServicesAvailable: servicesAvailable,
      firebaseConfigError: firebaseConfigError ?? null,
      firebaseApp,
      firestore,
      auth,
      user: userAuthState.user,
      isUserLoading: userAuthState.isUserLoading,
      userError: userAuthState.userError,
    };
  }, [firebaseApp, firestore, auth, firebaseConfigError, userAuthState]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      <FirestoreIndexPendingProvider>
        <FirebaseErrorListener />
        {children}
      </FirestoreIndexPendingProvider>
    </FirebaseContext.Provider>
  );
};

/**
 * Hook to access core Firebase services and user authentication state.
 */
export const useFirebase = (): FirebaseServicesAndUser => {
  const context = useContext(FirebaseContext);

  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider.');
  }

  // Handle SSR or loading states gracefully to prevent crashing top-level hook calls
  if (!context.areServicesAvailable || !context.firebaseApp || !context.firestore || !context.auth) {
    if (typeof window === 'undefined') {
      // Mock returns for SSR to avoid crashing during pre-render
      return {
        areServicesAvailable: false,
        firebaseConfigError: context.firebaseConfigError ?? null,
        firebaseApp: {} as any,
        firestore: {} as any,
        auth: {} as any,
        user: null,
        isUserLoading: true,
        userError: null
      };
    }
    // Also return a safe loading state on client if services are not yet ready
    return {
      areServicesAvailable: false,
      firebaseConfigError: context.firebaseConfigError ?? null,
      firebaseApp: {} as any,
      firestore: {} as any,
      auth: {} as any,
      user: null,
      isUserLoading: !context.firebaseConfigError,
      userError: null
    };
  }

  return {
    areServicesAvailable: true,
    firebaseConfigError: null,
    firebaseApp: context.firebaseApp,
    firestore: context.firestore,
    auth: context.auth,
    user: context.user,
    isUserLoading: context.isUserLoading,
    userError: context.userError,
  };
};

/** Hook to access Firebase Auth instance. */
export const useAuth = (): Auth => {
  const { auth } = useFirebase();
  return auth;
};

/** Hook to access Firestore instance. */
export const useFirestore = (): Firestore => {
  const { firestore } = useFirebase();
  return firestore;
};

/** Hook to access Firebase App instance. */
export const useFirebaseApp = (): FirebaseApp => {
  const { firebaseApp } = useFirebase();
  return firebaseApp;
};

export function useMemoFirebase<T>(factory: () => T, deps: DependencyList): T {
  return useMemo(() => {
    const value = factory();
    registerMemoFirebaseTarget(value);
    return value;
  }, deps);
}

/**
 * Hook specifically for accessing the authenticated user's state.
 */
export const useUser = (): UserHookResult => {
  const context = useContext(FirebaseContext);
  
  if (context) {
    const waitingForServices =
      !context.firebaseConfigError && !context.areServicesAvailable;
    return {
      user: context.user,
      isUserLoading: context.isUserLoading || waitingForServices,
      userError: context.userError,
    };
  }
  
  throw new Error('useUser must be used within a FirebaseProvider.');
};
