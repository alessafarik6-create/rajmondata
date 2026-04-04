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

/**
 * Detail produktu pro zákazníka — vždy světlý vzhled (bílé pozadí, černý text),
 * bez dark mode, aby se barvy nepřebíjely z globálního `dark` theme na <html>.
 */
type Props = {
  catalog: { id: string } & Partial<ProductCatalogDoc>;
  product: ProductCatalogProduct;
  jobId: string | null;
  companyId: string;
  customerUid: string;
  customerId: string | null;
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
    <section className="mx-auto max-w-3xl space-y-5 bg-white px-3 py-5 text-black sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="gap-1 text-black hover:bg-neutral-100 hover:text-black"
        >
          <Link href={backHref}>
            <ChevronLeft className="h-4 w-4 text-black" />
            {backLabel}
          </Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="aspect-[4/3] max-h-80 w-full bg-white sm:aspect-video sm:max-h-[22rem]">
          {mainImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mainImage} alt={product.name} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-600">
              Bez obrázku
            </div>
          )}
        </div>
        {gallery.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto border-t border-neutral-200 bg-white p-2">
            {gallery.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => setMainImage(url)}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-md ring-2 ring-offset-2 ring-offset-white transition-shadow ${
                  mainImage === url ? "ring-orange-500" : "ring-transparent hover:ring-neutral-300"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="space-y-4 bg-white p-4 text-black sm:p-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-black sm:text-2xl">
              {product.name || "Produkt"}
            </h1>
            {product.category ? (
              <p className="mt-1 text-sm text-neutral-800">{product.category}</p>
            ) : null}
            {typeof product.price === "number" ? (
              <p className="mt-2 text-lg font-semibold text-black">
                {product.price.toLocaleString("cs-CZ")} Kč
              </p>
            ) : null}
          </div>

          {(product.shortDescription ?? "").trim() ? (
            <p className="text-sm font-medium leading-relaxed text-black">
              {(product.shortDescription ?? "").trim()}
            </p>
          ) : null}

          {longDescription ? (
            <ExpandableDescription text={longDescription} tone="onWhite" />
          ) : null}

          {listNote ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm leading-relaxed text-black">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-800">
                Poznámka
              </p>
              <p className="mt-1 whitespace-pre-wrap text-black">{listNote}</p>
            </div>
          ) : null}

          {jobId && selection ? (
            <div className="pt-2">
              {selection.locked ? (
                <p className="text-sm font-medium text-emerald-800">
                  Výběr byl potvrzen administrátorem — změna není možná.
                </p>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  className="min-h-12 w-full sm:w-auto"
                  disabled={saving}
                  variant={isSelected ? "outlineLight" : "default"}
                  onClick={() => void handleToggle()}
                >
                  {saving ? "Ukládám…" : isSelected ? "Odebrat z výběru" : "Vybrat"}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-800">
              Pro výběr produktu otevřete katalog v rámci konkrétní zakázky.
            </p>
          )}
        </div>
      </div>

      {(prevP || nextP) && (
        <div className="flex flex-wrap justify-between gap-2 border-t border-neutral-200 bg-white pt-4">
          {prevP ? (
            <Button variant="outlineLight" size="sm" asChild className="gap-1">
              <Link href={`${basePath}/${prevP.id}`}>
                <ChevronLeft className="h-4 w-4" />
                Předchozí
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {nextP ? (
            <Button variant="outlineLight" size="sm" asChild className="gap-1">
              <Link href={`${basePath}/${nextP.id}`}>
                Další
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
