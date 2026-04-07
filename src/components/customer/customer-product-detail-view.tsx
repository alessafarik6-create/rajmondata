"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ExpandableDescription } from "@/components/customer/expandable-description";
import {
  persistCustomerCatalogSelection,
  computeToggledSelection,
} from "@/lib/customer-catalog-selection";
import { useFirestore } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  buildProductGalleryUrls,
  type JobProductSelectionDoc,
  type ProductCatalogDoc,
  type ProductCatalogProduct,
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

  const gallery = useMemo(() => buildProductGalleryUrls(product), [product]);

  const [mainImage, setMainImage] = useState(() => gallery[0] ?? "");
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    setMainImage((prev) => (prev && gallery.includes(prev) ? prev : gallery[0] ?? ""));
  }, [product.id, gallery]);

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
    <section className="mx-auto max-w-3xl space-y-5 bg-white px-3 py-5 text-black sm:px-4 lg:max-w-7xl xl:px-6">
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

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm lg:grid lg:grid-cols-5 lg:items-stretch lg:gap-0">
        <div className="flex flex-col lg:col-span-3 lg:border-r lg:border-neutral-200">
          <div
            className={cn(
              "flex w-full items-center justify-center bg-neutral-50",
              "aspect-[4/3] max-h-[min(48vh,18rem)] sm:max-h-[min(52vh,22rem)]",
              "lg:aspect-auto lg:max-h-none lg:min-h-[min(68vh,36rem)] xl:min-h-[min(72vh,40rem)]",
              "lg:max-w-none lg:p-4 xl:p-6"
            )}
          >
            {mainImage ? (
              <button
                type="button"
                className="flex h-full w-full max-w-4xl cursor-zoom-in items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 lg:max-w-[min(100%,56rem)] xl:max-w-[min(100%,900px)]"
                onClick={() => setLightboxOpen(true)}
                aria-label="Zvětšit obrázek"
              >
                {/* Plná URL z Storage — žádné zmenšené thumbs. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mainImage}
                  alt={product.name}
                  className="h-full max-h-[min(48vh,18rem)] w-full object-contain sm:max-h-[min(52vh,22rem)] lg:max-h-[min(75vh,900px)] lg:w-auto lg:max-w-full"
                  sizes="(max-width: 1024px) 100vw, 60vw"
                />
              </button>
            ) : (
              <div className="flex min-h-[12rem] w-full items-center justify-center text-sm text-neutral-600 lg:min-h-[20rem]">
                Bez obrázku
              </div>
            )}
          </div>
          {gallery.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto border-t border-neutral-200 bg-white px-2 py-3 sm:gap-3 sm:px-3 sm:py-4 lg:px-4">
              {gallery.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setMainImage(url)}
                  className={cn(
                    "h-16 w-16 shrink-0 overflow-hidden rounded-lg ring-2 ring-offset-2 ring-offset-white transition-shadow sm:h-20 sm:w-20 lg:h-24 lg:w-24 xl:h-[7.5rem] xl:w-[7.5rem]",
                    mainImage === url ? "ring-orange-500" : "ring-transparent hover:ring-neutral-300"
                  )}
                  aria-label="Zobrazit náhled"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="h-full w-full object-cover"
                    sizes="120px"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-4 bg-white p-4 text-black sm:p-6 lg:col-span-2 lg:flex lg:flex-col lg:justify-start lg:self-stretch lg:py-8 lg:pr-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-black sm:text-2xl lg:text-3xl">
              {product.name || "Produkt"}
            </h1>
            {product.category ? (
              <p className="mt-1 text-sm text-neutral-800 lg:text-base">{product.category}</p>
            ) : null}
            {typeof product.price === "number" ? (
              <p className="mt-2 text-lg font-semibold text-black lg:text-xl">
                {product.price.toLocaleString("cs-CZ")} Kč
              </p>
            ) : null}
          </div>

          {(product.shortDescription ?? "").trim() ? (
            <p className="text-sm font-medium leading-relaxed text-black lg:text-base">
              {(product.shortDescription ?? "").trim()}
            </p>
          ) : null}

          {longDescription ? (
            <ExpandableDescription text={longDescription} tone="onWhite" />
          ) : null}

          {listNote ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm leading-relaxed text-black lg:text-[0.9375rem]">
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

      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent
          className={cn(
            "left-1/2 top-1/2 flex max-h-[96vh] max-w-[96vw] -translate-x-1/2 -translate-y-1/2 flex-col",
            "w-full overflow-hidden border-0 bg-neutral-950 p-2 shadow-none ring-0 sm:max-w-[min(96vw,1400px)] sm:p-4",
            "[&_.absolute.right-3.top-3]:text-white [&_.absolute.right-3.top-3]:opacity-90 [&_.absolute.right-3.top-3]:hover:opacity-100"
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">{product.name} — zvětšený obrázek</DialogTitle>
          {mainImage ? (
            <div className="mx-auto flex max-h-[92vh] w-full items-center justify-center overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mainImage}
                alt=""
                className="h-auto max-h-[90vh] w-auto max-w-full object-contain object-center"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

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
