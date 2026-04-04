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

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-zinc-950">
        <div className="aspect-[4/3] max-h-80 w-full bg-zinc-100 sm:aspect-video sm:max-h-[22rem] dark:bg-zinc-900">
          {mainImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mainImage} alt={product.name} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-700 dark:text-zinc-300">
              Bez obrázku
            </div>
          )}
        </div>
        {gallery.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto border-t border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
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
        <div className="space-y-4 bg-white p-4 text-neutral-950 sm:p-6 dark:bg-zinc-950 dark:text-zinc-50">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl dark:text-zinc-50">
              {product.name || "Produkt"}
            </h1>
            {product.category ? (
              <p className="mt-1 text-sm text-neutral-800 dark:text-zinc-300">{product.category}</p>
            ) : null}
            {typeof product.price === "number" ? (
              <p className="mt-2 text-lg font-semibold text-neutral-950 dark:text-zinc-50">
                {product.price.toLocaleString("cs-CZ")} Kč
              </p>
            ) : null}
          </div>

          {(product.shortDescription ?? "").trim() ? (
            <p className="text-sm font-medium leading-relaxed text-neutral-950 dark:text-zinc-50">
              {(product.shortDescription ?? "").trim()}
            </p>
          ) : null}

          {longDescription ? (
            <ExpandableDescription text={longDescription} tone="highContrast" />
          ) : null}

          {listNote ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-100 p-3 text-sm leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-800 dark:text-zinc-300">
                Poznámka
              </p>
              <p className="mt-1 whitespace-pre-wrap text-neutral-950 dark:text-zinc-50">{listNote}</p>
            </div>
          ) : null}

          {jobId && selection ? (
            <div className="pt-2">
              {selection.locked ? (
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
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
            <p className="text-sm text-neutral-800 dark:text-zinc-300">
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
