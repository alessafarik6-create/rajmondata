'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { isGlobalAdminAppPath } from '@/lib/global-admin-shell';

/**
 * An invisible component that listens for globally emitted 'permission-error' events.
 * It throws any received error to be caught by Next.js's global-error.tsx.
 */
export function FirebaseErrorListener() {
  const pathname = usePathname() ?? '';
  // Use the specific error type for the state for type safety.
  const [error, setError] = useState<FirestorePermissionError | null>(null);

  useEffect(() => {
    // The callback now expects a strongly-typed error, matching the event payload.
    const handleError = (err: FirestorePermissionError) => {
      if (isGlobalAdminAppPath(pathname)) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            '[FirebaseErrorListener] permission-error ignored on global admin shell',
            err,
          );
        }
        return;
      }
      setError(err);
    };

    // The typed emitter will enforce that the callback for 'permission-error'
    // matches the expected payload type (FirestorePermissionError).
    errorEmitter.on('permission-error', handleError);

    // Unsubscribe on unmount to prevent memory leaks.
    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, [pathname]);

  // Na globální administraci neházet — tenant Firestore může emitovat permission-error i mimo modulovou logiku.
  if (error && !isGlobalAdminAppPath(pathname)) {
    throw error;
  }

  return null;
}
