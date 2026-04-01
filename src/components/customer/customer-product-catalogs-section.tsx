"use client";

import React, { useMemo, useState } from "react";
import { collection, doc, query, serverTimestamp, setDoc } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  catalogIsAssignedToCustomer,
  catalogIsAssignedToJob,
  type JobProductSelectionDoc,
  type ProductCatalogDoc,
} from "@/lib/product-catalogs";

type Props = {
  companyId: string;
  jobId: string;
  customerUid: string;
  customerId?: string | null;
};

export function CustomerProductCatalogsSection({
  companyId,
  jobId,
  customerUid,
  customerId = null,
}: Props) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const catalogsRef = useMemoFirebase(
    () => (firestore && companyId ? collection(firestore, "companies", companyId, "product_catalogs") : null),
    [firestore, companyId]
  );
  const { data: catalogsRaw } = useCollection(catalogsRef);
  const selectionsRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? query(collection(firestore, "companies", companyId, "jobs", jobId, "product_catalog_selections"))
        : null,
    [firestore, companyId, jobId]
  );
  const { data: selectionsRaw } = useCollection(selectionsRef);

  const catalogs = useMemo(() => {
    const rows = (catalogsRaw ?? []) as Array<{ id: string } & Partial<ProductCatalogDoc>>;
    const assigned = rows.filter(
      (c) =>
        c.active !== false &&
        c.customerVisible === true &&
        (catalogIsAssignedToJob(c, jobId) || catalogIsAssignedToCustomer(c, customerId ?? undefined))
    );
    if (process.env.NODE_ENV === "development") {
      console.log("assigned catalogs", assigned);
    }
    return assigned;
  }, [catalogsRaw, customerId, jobId]);

  const selectionMap = useMemo(() => {
    const map = new Map<string, JobProductSelectionDoc & { id: string }>();
    for (const s of (selectionsRaw ?? []) as Array<{ id: string } & Partial<JobProductSelectionDoc>>) {
      if (s.customerPortalUid !== customerUid) continue;
      if (!s.catalogId) continue;
      map.set(s.catalogId, s as JobProductSelectionDoc & { id: string });
    }
    if (process.env.NODE_ENV === "development") {
      console.log("customer selections", Array.from(map.values()));
    }
    return map;
  }, [selectionsRaw, customerUid]);

  const toggleProduct = async (
    catalog: { id: string } & Partial<ProductCatalogDoc>,
    productId: string
  ) => {
    if (!firestore) return;
    const mode = catalog.selectionMode === "single" ? "single" : "multi";
    const existing = selectionMap.get(catalog.id);
    const prev = new Set(existing?.selectedProductIds ?? []);
    if (mode === "single") {
      if (prev.has(productId)) prev.clear();
      else {
        prev.clear();
        prev.add(productId);
      }
    } else {
      if (prev.has(productId)) prev.delete(productId);
      else prev.add(productId);
    }
    const selectedProductIds = Array.from(prev);
    const docId = `${catalog.id}__${customerUid}`;
    const ref = doc(
      firestore,
      "companies",
      companyId,
      "jobs",
      jobId,
      "product_catalog_selections",
      docId
    );
    const payload: JobProductSelectionDoc = {
      companyId,
      jobId,
      customerPortalUid: customerUid,
      customerId: customerId ?? null,
      catalogId: catalog.id,
      selectedProductIds,
      selectedBy: customerUid,
      selectedAt: serverTimestamp(),
      status: "submitted",
      note: existing?.note ?? null,
      createdAt: existing?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    setSavingKey(`${catalog.id}:${productId}`);
    try {
      await setDoc(ref, payload, { merge: true });
      toast({ title: "Výběr uložen", description: "Vaše volba byla uložena." });
    } finally {
      setSavingKey(null);
    }
  };

  const saveNote = async (catalogId: string, note: string) => {
    if (!firestore) return;
    const docId = `${catalogId}__${customerUid}`;
    const ref = doc(
      firestore,
      "companies",
      companyId,
      "jobs",
      jobId,
      "product_catalog_selections",
      docId
    );
    const existing = selectionMap.get(catalogId);
    const payload: Partial<JobProductSelectionDoc> = {
      companyId,
      jobId,
      customerPortalUid: customerUid,
      customerId: customerId ?? null,
      catalogId,
      selectedProductIds: existing?.selectedProductIds ?? [],
      selectedBy: customerUid,
      selectedAt: serverTimestamp(),
      status: existing?.status ?? "draft",
      note: note.trim() || null,
      createdAt: existing?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    setSavingKey(`${catalogId}:note`);
    try {
      await setDoc(ref, payload, { merge: true });
      toast({ title: "Poznámka uložena" });
    } finally {
      setSavingKey(null);
    }
  };

  if (!catalogs.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Katalog produktů</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Zatím pro vás nejsou připravené žádné produktové katalogy.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {catalogs.map((catalog) => {
        const selected = new Set(selectionMap.get(catalog.id)?.selectedProductIds ?? []);
        const noteDefault = selectionMap.get(catalog.id)?.note ?? "";
        return (
          <Card key={catalog.id}>
            <CardHeader>
              <CardTitle className="text-lg">{catalog.name || "Katalog"}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Režim výběru: {catalog.selectionMode === "single" ? "Jedna položka" : "Více položek"}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(catalog.products ?? [])
                  .filter((p) => p && p.active !== false)
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((p) => {
                    const isSelected = selected.has(p.id);
                    return (
                      <div key={p.id} className="rounded-lg border p-3">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt={p.name} className="mb-2 h-40 w-full rounded-md object-cover" />
                        ) : null}
                        <p className="font-medium">{p.name}</p>
                        {p.description ? <p className="text-sm text-muted-foreground">{p.description}</p> : null}
                        {typeof p.price === "number" ? (
                          <p className="mt-1 text-sm font-semibold">{p.price.toLocaleString("cs-CZ")} Kč</p>
                        ) : null}
                        <Button
                          type="button"
                          className="mt-2 w-full"
                          variant={isSelected ? "secondary" : "default"}
                          disabled={savingKey === `${catalog.id}:${p.id}`}
                          onClick={() => void toggleProduct(catalog, p.id)}
                        >
                          {isSelected ? "Vybráno" : "Vybrat"}
                        </Button>
                      </div>
                    );
                  })}
              </div>
              <Input
                defaultValue={noteDefault || ""}
                placeholder="Poznámka k výběru…"
                onBlur={(e) => {
                  void saveNote(catalog.id, e.target.value);
                }}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

