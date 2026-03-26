"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Registry = {
  register: (id: string) => void;
  unregister: (id: string) => void;
};

const FirestoreIndexPendingContext = createContext<Registry | null>(null);

/**
 * Obalí aplikaci a zobrazí nahoře informaci, pokud nějaký `useCollection` / `useDoc`
 * hlásí chybějící index (registrace z hooků).
 */
export function FirestoreIndexPendingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  const register = useCallback((id: string) => {
    setIds((s) => {
      if (s.has(id)) return s;
      const n = new Set(s);
      n.add(id);
      return n;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setIds((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }, []);

  const value = useMemo(() => ({ register, unregister }), [register, unregister]);
  const show = ids.size > 0;

  return (
    <FirestoreIndexPendingContext.Provider value={value}>
      {show ? (
        <Alert
          role="status"
          className="relative z-[100] mb-0 rounded-none border-x-0 border-t-0 bg-muted/80 text-foreground"
        >
          <AlertDescription className="text-center text-sm text-gray-900">
            Data se připravují… (Firestore index se může ještě vytvářet)
          </AlertDescription>
        </Alert>
      ) : null}
      {children}
    </FirestoreIndexPendingContext.Provider>
  );
}

export function useFirestoreIndexPendingRegistry(): Registry | null {
  return useContext(FirestoreIndexPendingContext);
}
