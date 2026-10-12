"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
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

  return (
    <FirestoreIndexPendingContext.Provider value={value}>
      {children}
    </FirestoreIndexPendingContext.Provider>
  );
}

export function useFirestoreIndexPendingRegistry(): Registry | null {
  return useContext(FirestoreIndexPendingContext);
}
