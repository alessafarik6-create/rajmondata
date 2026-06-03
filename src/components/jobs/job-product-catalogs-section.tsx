"use client";

import React, { useMemo } from "react";
import { collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  catalogIsAssignedToJob,
  type JobProductSelectionDoc,
  type ProductCatalogDoc,
  type ProductSelectionSnapshot,
} from "@/lib/product-catalogs";
import { formatDateSafe } from "@/lib/date-safe";

type Props = {
  companyId: string;
  jobId: string;
};

export function JobProductCatalogsSection({ companyId, jobId }: Props) {
  const { toast } = useToast();
  const formatAnyDate = (value: unknown): string => {
    const s = formatDateSafe(value);
    return s === "Neznámé datum" || s === "bez data" ? "" : s;
  };
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
      console.log("job selections", selectionsData ?? []);
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
        confirmedAt: serverTimestamp(),
        confirmedBy: user.uid,
        updatedAt: serverTimestamp(),
      }
    );
    toast({
      title: "Výběr byl potvrzen",
      description: "Zákazník už nemůže upravit potvrzený výběr.",
    });
  };

  const unlockSelection = async (selectionId: string) => {
    if (!firestore || !user?.uid) return;
    await updateDoc(
      doc(firestore, "companies", companyId, "jobs", jobId, "product_catalog_selections", selectionId),
      {
        status: "submitted",
        updatedAt: serverTimestamp(),
      }
    );
    toast({ title: "Výběr odemknut" });
  };

  const statusBadge = (status?: string) => {
    if (status === "confirmed") return "bg-emerald-100 text-emerald-800";
    if (status === "selected") return "bg-indigo-100 text-indigo-800";
    if (status === "submitted") return "bg-blue-100 text-blue-800";
    return "bg-amber-100 text-amber-800";
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
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadge(sel.status)}`}>
                            {sel.status === "confirmed"
                              ? "Potvrzeno"
                              : sel.status === "selected"
                                ? "Vybráno"
                              : sel.status === "submitted"
                                ? "Odesláno"
                                : "Rozpracováno"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatAnyDate(sel.selectedAt)}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {(sel.selectedProducts ?? []).length || (sel.selectedProductIds ?? []).length ? (
                            (
                              (sel.selectedProducts ?? []).length
                                ? (sel.selectedProducts ?? [])
                                : (sel.selectedProductIds ?? []).map((id) => {
                                    const cur = (catalog.products ?? []).find((x) => x.id === id);
                                    return {
                                      productId: id,
                                      productNameSnapshot: cur?.name || id,
                                      productImageSnapshot: cur?.imageUrl,
                                      catalogNameSnapshot: catalog.name || "Katalog",
                                      categorySnapshot: cur?.category,
                                    };
                                  })
                            ).map((p) => {
                              const row = p as ProductSelectionSnapshot;
                              const customerNote =
                                typeof row.customerNote === "string" ? row.customerNote.trim() : "";
                              const hasSnapshotNotes = (sel.selectedProducts ?? []).length > 0;
                              return (
                              <div key={row.productId} className="flex items-center gap-2 rounded border bg-white p-2">
                                {row.productImageSnapshot ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={row.productImageSnapshot}
                                    alt={row.productNameSnapshot}
                                    className="h-14 w-14 rounded-md object-cover"
                                  />
                                ) : (
                                  <div className="h-14 w-14 rounded-md bg-muted" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium">{row.productNameSnapshot || row.productId}</p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {row.catalogNameSnapshot || catalog.name || "Katalog"} ·{" "}
                                    {row.categorySnapshot || "Bez kategorie"}
                                  </p>
                                  {hasSnapshotNotes ? (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {customerNote ? (
                                        <>
                                          Poznámka zákazníka:{" "}
                                          <span className="whitespace-pre-wrap text-foreground">
                                            {customerNote}
                                          </span>
                                        </>
                                      ) : (
                                        <span className="italic">Bez poznámky</span>
                                      )}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            );
                            })
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Vybral:{" "}
                              {(sel.selectedProductIds ?? []).length
                                ? (sel.selectedProductIds ?? []).join(", ")
                                : "nic"}
                            </p>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Stav: {sel.status ?? "draft"} · Vybral:{" "}
                          {sel.selectedBy === "customer" ? "zákazník" : sel.selectedBy ?? "—"} ·
                          Uživatel: {sel.selectedByUserId ?? sel.customerPortalUid ?? "—"}
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
                          {sel.status === "confirmed" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void unlockSelection(sel.id)}
                            >
                              Odemknout
                            </Button>
                          ) : null}
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

