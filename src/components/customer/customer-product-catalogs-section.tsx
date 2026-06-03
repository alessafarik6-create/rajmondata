"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { collection, doc, query, serverTimestamp, setDoc } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { createCustomerActivity } from "@/lib/customer-activity";
import {
  buildProductSelectionSnapshots,
  computeToggledSelection,
  getProductCustomerNote,
  persistCustomerCatalogSelection,
  persistCustomerProductNote,
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
  readOnly?: boolean;
};

export function CustomerProductCatalogsSection({
  companyId,
  jobId,
  customerUid,
  customerId = null,
  readOnly = false,
}: Props) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
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
    if (readOnly || !firestore) return;
    const existing = selectionMap.get(catalog.id);
    const isSelectionLocked = existing?.status === "confirmed";
    if (isSelectionLocked) {
      toast({
        variant: "destructive",
        title: "Výběr je uzamčen a nelze ho změnit",
      });
      return;
    }
    const prevIds = existing?.selectedProductIds ?? [];
    const nextIds = computeToggledSelection(catalog, productId, prevIds);
    const wasSelected = prevIds.includes(productId);
    setSavingKey(`${catalog.id}:${productId}`);
    const noteKey = `${catalog.id}:${productId}`;
    if (wasSelected) {
      setNoteDrafts((d) => {
        const next = { ...d };
        delete next[noteKey];
        return next;
      });
    }
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
      toast({
        title: wasSelected ? "Produkt odznačen" : "Produkt vybrán",
        description: wasSelected
          ? "Položka byla odebrána z výběru."
          : "Položka byla přidána do výběru.",
      });
    } catch {
      toast({ variant: "destructive", title: "Uložení se nezdařilo" });
    } finally {
      setSavingKey(null);
    }
  };

  const saveProductNote = async (
    catalog: { id: string } & Partial<ProductCatalogDoc>,
    productId: string,
    productName: string,
    note: string
  ) => {
    if (readOnly || !firestore) return;
    const existing = selectionMap.get(catalog.id);
    if (existing?.status === "confirmed") {
      toast({ variant: "destructive", title: "Výběr je uzamčen a nelze ho změnit" });
      return;
    }
    if (!(existing?.selectedProductIds ?? []).includes(productId)) return;
    const noteKey = `${catalog.id}:${productId}`;
    setSavingKey(`${noteKey}:note`);
    try {
      const result = await persistCustomerProductNote({
        firestore,
        companyId,
        jobId,
        customerUid,
        customerId: customerId ?? null,
        catalog,
        productId,
        productName,
        note,
        existing,
      });
      if (result.saved && result.activityCreated) {
        toast({ title: "Poznámka uložena" });
      }
    } catch {
      toast({ variant: "destructive", title: "Poznámku se nepodařilo uložit" });
    } finally {
      setSavingKey(null);
    }
  };

  const saveNote = async (catalog: { id: string } & Partial<ProductCatalogDoc>, note: string) => {
    if (readOnly || !firestore) return;
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
      organizationId: companyId,
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
      selectedBy: "customer",
      selectedByUserId: customerUid,
      selectedAt: serverTimestamp(),
      status: existing?.status ?? "selected",
      note: note.trim() || null,
      createdAt: existing?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const prevNote = (existing?.note ?? "").trim();
    const nextNote = note.trim();
    if (nextNote === prevNote) return;

    setSavingKey(`${catalog.id}:note`);
    try {
      await setDoc(ref, payload, { merge: true });
      if (nextNote) {
        await createCustomerActivity(firestore, {
          organizationId: companyId,
          jobId,
          customerId: customerId ?? null,
          customerUserId: customerUid,
          type: "customer_note_added",
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
      }
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
        const selectionRow = selectionMap.get(catalog.id);
        const isSelectionLocked = selectionMap.get(catalog.id)?.status === "confirmed";
        const noteDefault = selectionMap.get(catalog.id)?.note ?? "";
        const catalogHref = `/portal/customer/jobs/${jobId}/catalogs/${catalog.id}`;
        const navOff = readOnly;
        const visibleProducts = [...(catalog.products ?? [])]
          .filter((p) => p && p.active !== false && p.archived !== true)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        return (
          <Card key={catalog.id}>
            <CardHeader className="space-y-3 pb-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-lg leading-snug">
                    {navOff ? (
                      <span className="text-foreground">{catalog.name || "Katalog"}</span>
                    ) : (
                      <Link
                        href={catalogHref}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {catalog.name || "Katalog"}
                      </Link>
                    )}
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Režim výběru: {catalog.selectionMode === "single" ? "Jedna položka" : "Více položek"}
                  </p>
                </div>
                {navOff ? (
                  <Button size="sm" variant="outline" className="shrink-0" disabled>
                    Detail katalogu
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" asChild className="shrink-0">
                    <Link href={catalogHref}>Detail katalogu</Link>
                  </Button>
                )}
              </div>
              {isSelectionLocked ? (
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Výběr byl potvrzen administrátorem (uzamčeno).
                </p>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {selectionRow && (selectionRow.selectedProducts ?? []).length > 0 ? (
                <div className="rounded-md border bg-muted/20 p-2">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Vybrané produkty · stav {selectionRow.status ?? "selected"} ·{" "}
                    {typeof (selectionRow.selectedAt as { toDate?: () => Date } | undefined)?.toDate ===
                    "function"
                      ? (selectionRow.selectedAt as { toDate: () => Date }).toDate().toLocaleString("cs-CZ")
                      : "datum není dostupné"}
                  </p>
                  <ul className="space-y-1">
                    {(selectionRow.selectedProducts ?? []).map((sp) => (
                      <li key={sp.productId} className="flex items-center gap-2 text-xs">
                        {sp.productImageSnapshot ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={sp.productImageSnapshot} alt="" className="h-8 w-8 rounded object-cover" />
                        ) : (
                          <div className="h-8 w-8 rounded bg-muted" />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {sp.productNameSnapshot || sp.productId}
                          {typeof sp.customerNote === "string" && sp.customerNote.trim() ? (
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {sp.customerNote.trim()}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <CustomerCatalogCompactRow
                href={catalogHref}
                catalog={catalog}
                className="sm:hidden"
                navigationDisabled={navOff}
              />
              <ul className="space-y-2">
                {visibleProducts.map((p) => {
                  const isSelected = selected.has(p.id);
                  const productHref = `${catalogHref}/products/${p.id}`;
                  const noteKey = `${catalog.id}:${p.id}`;
                  const existing = selectionMap.get(catalog.id);
                  const savedNote = getProductCustomerNote(existing, p.id);
                  const noteValue =
                    noteDrafts[noteKey] !== undefined ? noteDrafts[noteKey] : savedNote;
                  return (
                    <li key={p.id} className="space-y-2">
                      <CustomerProductCompactRow
                        href={productHref}
                        product={p}
                        selected={isSelected}
                        navigationDisabled={navOff}
                        trailing={
                          readOnly ? null : (
                            <Button
                              type="button"
                              size="sm"
                              className="min-h-10 w-[5.5rem] px-2 text-xs sm:text-sm"
                              variant={isSelected ? "secondary" : "default"}
                              disabled={savingKey === `${catalog.id}:${p.id}` || isSelectionLocked}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void toggleProduct(catalog, p.id);
                              }}
                            >
                              {isSelected ? "Vybráno" : "Vybrat"}
                            </Button>
                          )
                        }
                      />
                      {isSelected && !readOnly ? (
                        <div
                          className={cn(
                            "rounded-lg border border-primary/20 bg-primary/5 p-3",
                            "ml-0 sm:ml-[3.75rem]"
                          )}
                        >
                          <Label
                            htmlFor={`product-note-${noteKey}`}
                            className="text-sm font-medium"
                          >
                            Poznámka k produktu{" "}
                            <span className="font-normal text-muted-foreground">(volitelné)</span>
                          </Label>
                          <Textarea
                            id={`product-note-${noteKey}`}
                            value={noteValue}
                            onChange={(e) =>
                              setNoteDrafts((d) => ({ ...d, [noteKey]: e.target.value }))
                            }
                            onBlur={() =>
                              void saveProductNote(
                                catalog,
                                p.id,
                                p.name || "Produkt",
                                noteValue
                              )
                            }
                            disabled={isSelectionLocked || savingKey === `${noteKey}:note`}
                            placeholder="Volitelná poznámka k tomuto produktu…"
                            rows={3}
                            className="mt-1.5 min-h-[5.5rem] resize-y text-base sm:text-sm"
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {!visibleProducts.length ? (
                <p className="text-sm text-muted-foreground">V katalogu nejsou žádné aktivní produkty.</p>
              ) : null}
              <Input
                defaultValue={noteDefault || ""}
                placeholder="Poznámka k celému výběru (volitelné)…"
                disabled={readOnly || isSelectionLocked}
                onBlur={(e) => {
                  if (readOnly) return;
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
