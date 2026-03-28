"use client";

import React, { createContext, useContext, useMemo } from "react";
import { collection } from "firebase/firestore";
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { PLATFORM_MODULES_COLLECTION } from "@/lib/firestore-collections";
import type { PlatformModuleCode } from "@/lib/platform-config";
import {
  buildMergedPlatformCatalogMap,
  defaultPlatformCatalogMap,
  type PlatformModuleCatalogRow,
} from "@/lib/platform-module-catalog";

export type MergedPlatformCatalog = Record<PlatformModuleCode, PlatformModuleCatalogRow>;

const PlatformModuleCatalogContext = createContext<MergedPlatformCatalog | null>(null);

/**
 * Načte `platform_modules` a sloučí s výchozími hodnotami z kódu.
 * Použití v portálu pro `hasActiveModuleAccess(..., catalog)` a fallback při chybějícím org. záznamu.
 */
export function PlatformModuleCatalogProvider({ children }: { children: React.ReactNode }) {
  const firestore = useFirestore();
  const modulesQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, PLATFORM_MODULES_COLLECTION) : null),
    [firestore]
  );
  const { data } = useCollection(modulesQuery, {
    suppressGlobalPermissionError: true,
  });

  const value = useMemo(
    () => buildMergedPlatformCatalogMap(Array.isArray(data) ? data : []),
    [data]
  );

  return (
    <PlatformModuleCatalogContext.Provider value={value}>{children}</PlatformModuleCatalogContext.Provider>
  );
}

/** Sloučený globální katalog; mimo providera bezpečně vrátí výchozí z kódu. */
export function useMergedPlatformModuleCatalog(): MergedPlatformCatalog {
  const ctx = useContext(PlatformModuleCatalogContext);
  return ctx ?? defaultPlatformCatalogMap();
}
