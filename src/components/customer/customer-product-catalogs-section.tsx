"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { collection, doc, query, serverTimestamp, setDoc } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { createCustomerActivity } from "@/lib/customer-activity";
import {
  buildProductSelectionSnapshots,
  computeToggledSelection,
  persistCustomerCatalogSelection,
} from "@/lib/customer-catalog-selection";
import {
  catalogIsAssignedToCustomer,
  catalogIsAssignedToJob,
  type JobProductSelectionDoc,
  type ProductCatalogDoc,
} from "@/lib/product-catalogs";
import {
  CustomerCatalogCompactRow,
  CustomerProductCompactRow,
} from "@/components/customer/customer-catalog-ui";
import { isCatalogCustomerVisibleForPortal } from "@/lib/customer-catalog-visibility";

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
        isCatalogCustomerVisibleForPortal(c) &&
        (catalogIsAssignedToJob(c, jobId) || catalogIsAssignedToCustomer(c, customerId ?? undefined))
    );
    return assigned;
  }, [catalogsRaw, customerId, jobId]);

  const selectionMap = useMemo(() => {
    const map = new Map<string, JobProductSelectionDoc & { id: string }>();
    for (const s of (selectionsRaw ?? []) as Array<{ id: string } & Partial<JobProductSelectionDoc>>) {
      if (s.customerPortalUid !== customerUid) continue;
      if (!s.catalogId) continue;
      map.set(s.catalogId, s as JobProductSelectionDoc & { id: string });
    }
    return map;
  }, [selectionsRaw, customerUid]);

  const toggleProduct = async (
    catalog: { id: string } & Partial<ProductCatalogDoc>,
    productId: string
  ) => {
    if (!firestore) return;
    const existing = selectionMap.get(catalog.id);
    const isSelectionLocked = existing?.status === "confirmed";
    if (isSelectionLocked) {
      toast({
        variant: "destructive",
        title: "Výběr je uzamčen a nelze ho změnit",
      });
      return;
    }
    const nextIds = computeToggledSelection(catalog, productId, existing?.selectedProductIds ?? []);
    setSavingKey(`${catalog.id}:${productId}`);
    try {
      await persistCustomerCatalogSelection({
        firestore,
        companyId,
        jobId,
        customerUid,
        customerId: customerId ?? null,
        catalog,
        selectedProductIds: nextIds,
        existing,
      });
      toast({ title: "Výběr uložen", description: "Vaše volba byla uložena." });
    } catch {
      toast({ variant: "destructive", title: "Uložení se nezdařilo" });
    } finally {
      setSavingKey(null);
    }
  };

  const saveNote = async (catalog: { id: string } & Partial<ProductCatalogDoc>, note: string) => {
    if (!firestore) return;
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
    const existing = selectionMap.get(catalog.id);
    const isSelectionLocked = existing?.status === "confirmed";
    if (isSelectionLocked) {
      toast({
        variant: "destructive",
        title: "Výběr je uzamčen a nelze ho změnit",
      });
      return;
    }
    const payload: Partial<JobProductSelectionDoc> = {
      companyId,
      jobId,
      customerPortalUid: customerUid,
      customerId: customerId ?? null,
      catalogId: catalog.id,
      selectedProductIds: existing?.selectedProductIds ?? [],
      selectedProducts: buildProductSelectionSnapshots(
        catalog,
        existing?.selectedProductIds ?? [],
        existing
      ),
      selectedBy: customerUid,
      selectedAt: serverTimestamp(),
      status: existing?.status ?? "draft",
      note: note.trim() || null,
      createdAt: existing?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    setSavingKey(`${catalog.id}:note`);
    try {
      await setDoc(ref, payload, { merge: true });
      await createCustomerActivity(firestore, {
        organizationId: companyId,
        jobId,
        customerId: customerId ?? null,
        customerUserId: customerUid,
        type: "customer_product_selection_updated",
        title: "Poznámka k výběru",
        message: "Zákazník doplnil poznámku k výběru produktů.",
        createdBy: customerUid,
        createdByRole: "customer",
        isRead: false,
        targetType: "catalog-selection",
        targetId: catalog.id,
        targetLink: `/portal/jobs/${jobId}`,
      });
      toast({ title: "Poznámka uložena" });
    } finally {
      setSavingKey(null);
    }
  };

  if (!catalogs.length) {
    return (
      <Card id="customer-product-catalogs" className="scroll-mt-4">
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
    <div id="customer-product-catalogs" className="space-y-4 scroll-mt-4">
      {catalogs.map((catalog) => {
        const selected = new Set(selectionMap.get(catalog.id)?.selectedProductIds ?? []);
        const isSelectionLocked = selectionMap.get(catalog.id)?.status === "confirmed";
        const noteDefault = selectionMap.get(catalog.id)?.note ?? "";
        const catalogHref = `/portal/customer/jobs/${jobId}/catalogs/${catalog.id}`;
        const visibleProducts = [...(catalog.products ?? [])]
          .filter((p) => p && p.active !== false && p.archived !== true)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        return (
          <Card key={catalog.id}>
            <CardHeader className="space-y-3 pb-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-lg leading-snug">
                    <Link
                      href={catalogHref}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {catalog.name || "Katalog"}
                    </Link>
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Režim výběru: {catalog.selectionMode === "single" ? "Jedna položka" : "Více položek"}
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild className="shrink-0">
                  <Link href={catalogHref}>Detail katalogu</Link>
                </Button>
              </div>
              {isSelectionLocked ? (
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Výběr byl potvrzen administrátorem (uzamčeno).
                </p>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <CustomerCatalogCompactRow href={catalogHref} catalog={catalog} className="sm:hidden" />
              <ul className="space-y-2">
                {visibleProducts.map((p) => {
                  const isSelected = selected.has(p.id);
                  const productHref = `${catalogHref}/products/${p.id}`;
                  return (
                    <li key={p.id}>
                      <CustomerProductCompactRow
                        href={productHref}
                        product={p}
                        trailing={
                          <Button
                            type="button"
                            size="sm"
                            className="min-h-10 w-[5.5rem] px-2 text-xs sm:text-sm"
                            variant={isSelected ? "secondary" : "default"}
                            disabled={savingKey === `${catalog.id}:${p.id}` || isSelectionLocked}
                            onClick={(e) => {
                              e.preventDefault();
                              void toggleProduct(catalog, p.id);
                            }}
                          >
                            {isSelected ? "Vybráno" : "Vybrat"}
                          </Button>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
              {!visibleProducts.length ? (
                <p className="text-sm text-muted-foreground">V katalogu nejsou žádné aktivní produkty.</p>
              ) : null}
              <Input
                defaultValue={noteDefault || ""}
                placeholder="Poznámka k výběru…"
                disabled={isSelectionLocked}
                onBlur={(e) => {
                  void saveNote(catalog, e.target.value);
                }}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
