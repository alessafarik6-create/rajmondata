"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandableDescription } from "@/components/customer/expandable-description";
import {
  persistCustomerCatalogSelection,
  computeToggledSelection,
} from "@/lib/customer-catalog-selection";
import { useFirestore } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import type {
  JobProductSelectionDoc,
  ProductCatalogDoc,
  ProductCatalogProduct,
} from "@/lib/product-catalogs";

type Props = {
  catalog: { id: string } & Partial<ProductCatalogDoc>;
  product: ProductCatalogProduct;
  jobId: string | null;
  companyId: string;
  customerUid: string;
  customerId: string | null;
  /** Výběr v zakázce — bez props se zobrazí jen návod k otevření přes zakázku */
  selection?: {
    existing: (JobProductSelectionDoc & { id: string }) | undefined;
    locked: boolean;
  };
  backHref: string;
  backLabel: string;
};

export function CustomerProductDetailView({
  catalog,
  product,
  jobId,
  companyId,
  customerUid,
  customerId,
  selection,
  backHref,
  backLabel,
}: Props) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const orderedProducts = useMemo(() => {
    return [...(catalog.products ?? [])]
      .filter((p) => p && p.active !== false && p.archived !== true)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [catalog.products]);

  const idx = orderedProducts.findIndex((p) => p.id === product.id);
  const prevP = idx > 0 ? orderedProducts[idx - 1] : null;
  const nextP = idx >= 0 && idx < orderedProducts.length - 1 ? orderedProducts[idx + 1] : null;

  const basePath = jobId
    ? `/portal/customer/jobs/${jobId}/catalogs/${catalog.id}/products`
    : `/portal/customer/catalogs/${catalog.id}/products`;

  const gallery = [product.imageUrl, ...(product.gallery ?? [])].filter(
    (u, i, a): u is string => typeof u === "string" && u.length > 0 && a.indexOf(u) === i
  );

  const [mainImage, setMainImage] = useState(gallery[0] ?? "");

  const isSelected = selection?.existing?.selectedProductIds?.includes(product.id) ?? false;

  const handleToggle = async () => {
    if (!firestore || !jobId || !selection || selection.locked) return;
    const nextIds = computeToggledSelection(catalog, product.id, selection.existing?.selectedProductIds ?? []);
    setSaving(true);
    try {
      await persistCustomerCatalogSelection({
        firestore,
        companyId,
        jobId,
        customerUid,
        customerId,
        catalog,
        selectedProductIds: nextIds,
        existing: selection.existing,
      });
      toast({ title: "Výběr uložen", description: "Vaše volba byla uložena." });
    } catch {
      toast({ variant: "destructive", title: "Uložení se nezdařilo" });
    } finally {
      setSaving(false);
    }
  };

  const listNote = (product.note ?? "").trim();
  const longDescription = (product.description ?? "").trim();

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-3 py-5 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link href={backHref}>
            <ChevronLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-card shadow-sm dark:border-slate-700">
        <div className="aspect-[4/3] max-h-80 w-full bg-muted sm:aspect-video sm:max-h-[22rem]">
          {mainImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mainImage} alt={product.name} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Bez obrázku
            </div>
          )}
        </div>
        {gallery.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto border-t border-slate-100 p-2 dark:border-slate-800">
            {gallery.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => setMainImage(url)}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-md ring-2 ring-offset-2 ring-offset-background transition-shadow ${
                  mainImage === url ? "ring-primary" : "ring-transparent hover:ring-muted-foreground/30"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="space-y-4 p-4 sm:p-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{product.name || "Produkt"}</h1>
            {product.category ? (
              <p className="mt-1 text-sm text-muted-foreground">{product.category}</p>
            ) : null}
            {typeof product.price === "number" ? (
              <p className="mt-2 text-lg font-semibold text-primary">
                {product.price.toLocaleString("cs-CZ")} Kč
              </p>
            ) : null}
          </div>

          {(product.shortDescription ?? "").trim() ? (
            <p className="text-sm font-medium leading-relaxed text-slate-800 dark:text-slate-100">
              {(product.shortDescription ?? "").trim()}
            </p>
          ) : null}

          {longDescription ? <ExpandableDescription text={longDescription} /> : null}

          {listNote ? (
            <div className="rounded-lg border border-slate-100 bg-muted/40 p-3 text-sm leading-relaxed dark:border-slate-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Poznámka
              </p>
              <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-200">{listNote}</p>
            </div>
          ) : null}

          {jobId && selection ? (
            <div className="pt-2">
              {selection.locked ? (
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Výběr byl potvrzen administrátorem — změna není možná.
                </p>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  className="w-full sm:w-auto min-h-12"
                  disabled={saving}
                  variant={isSelected ? "secondary" : "default"}
                  onClick={() => void handleToggle()}
                >
                  {saving ? "Ukládám…" : isSelected ? "Odebrat z výběru" : "Vybrat"}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pro výběr produktu otevřete katalog v rámci konkrétní zakázky.
            </p>
          )}
        </div>
      </div>

      {(prevP || nextP) && (
        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          {prevP ? (
            <Button variant="outline" size="sm" asChild className="gap-1">
              <Link href={`${basePath}/${prevP.id}`}>
                <ChevronLeft className="h-4 w-4" />
                Předchozí
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {nextP ? (
            <Button variant="outline" size="sm" asChild className="gap-1">
              <Link href={`${basePath}/${nextP.id}`}>
                Další
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
