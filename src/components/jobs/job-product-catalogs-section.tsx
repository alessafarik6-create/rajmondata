"use client";

import React, { useMemo } from "react";
import { collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  catalogIsAssignedToJob,
  type JobProductSelectionDoc,
  type ProductCatalogDoc,
} from "@/lib/product-catalogs";

type Props = {
  companyId: string;
  jobId: string;
};

export function JobProductCatalogsSection({ companyId, jobId }: Props) {
  const { user } = useUser();
  const firestore = useFirestore();
  const catalogsRef = useMemoFirebase(
    () => (firestore && companyId ? collection(firestore, "companies", companyId, "product_catalogs") : null),
    [firestore, companyId]
  );
  const selectionsRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(firestore, "companies", companyId, "jobs", jobId, "product_catalog_selections")
        : null,
    [firestore, companyId, jobId]
  );
  const { data: catalogsData } = useCollection(catalogsRef);
  const { data: selectionsData } = useCollection(selectionsRef);

  const assignedCatalogs = useMemo(() => {
    const rows = (catalogsData ?? []) as Array<{ id: string } & Partial<ProductCatalogDoc>>;
    const list = rows.filter((c) => c.active !== false && catalogIsAssignedToJob(c, jobId));
    if (process.env.NODE_ENV === "development") {
      console.log("job product selections", selectionsData ?? []);
    }
    return list;
  }, [catalogsData, jobId, selectionsData]);

  const selectionsByCatalog = useMemo(() => {
    const map = new Map<string, Array<{ id: string } & Partial<JobProductSelectionDoc>>>();
    for (const row of (selectionsData ?? []) as Array<{ id: string } & Partial<JobProductSelectionDoc>>) {
      if (!row.catalogId) continue;
      const arr = map.get(row.catalogId) ?? [];
      arr.push(row);
      map.set(row.catalogId, arr);
    }
    return map;
  }, [selectionsData]);

  const confirmSelection = async (selectionId: string) => {
    if (!firestore || !user?.uid) return;
    await updateDoc(
      doc(firestore, "companies", companyId, "jobs", jobId, "product_catalog_selections", selectionId),
      {
        status: "confirmed",
        updatedAt: serverTimestamp(),
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Produktové katalogy pro zákazníka</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!assignedCatalogs.length ? (
          <p className="text-sm text-muted-foreground">K této zakázce zatím není přiřazený žádný katalog.</p>
        ) : (
          assignedCatalogs.map((catalog) => {
            const rows = selectionsByCatalog.get(catalog.id) ?? [];
            return (
              <div key={catalog.id} className="rounded-lg border p-3">
                <p className="font-medium">{catalog.name || "Katalog"}</p>
                <p className="text-xs text-muted-foreground">
                  Režim: {catalog.selectionMode === "single" ? "Jedna položka" : "Více položek"}
                </p>
                {!rows.length ? (
                  <p className="mt-2 text-sm text-muted-foreground">Zákazník zatím nic nevybral.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {rows.map((sel) => (
                      <div key={sel.id} className="rounded border bg-muted/30 p-2 text-sm">
                        <p>
                          Vybral:{" "}
                          <strong>
                            {(sel.selectedProductIds ?? []).length
                              ? (sel.selectedProductIds ?? []).join(", ")
                              : "nic"}
                          </strong>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Stav: {sel.status ?? "draft"} · Uživatel: {sel.customerPortalUid ?? "—"}
                        </p>
                        {sel.note ? <p className="text-xs">Poznámka: {sel.note}</p> : null}
                        <div className="mt-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={sel.status === "confirmed"}
                            onClick={() => void confirmSelection(sel.id)}
                          >
                            {sel.status === "confirmed" ? "Potvrzeno" : "Potvrdit výběr"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

