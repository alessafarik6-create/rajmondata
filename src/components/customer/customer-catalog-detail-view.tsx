"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandableDescription } from "@/components/customer/expandable-description";
import {
  CustomerProductCompactRow,
  catalogSubtitleForList,
} from "@/components/customer/customer-catalog-ui";
import type { ProductCatalogDoc, ProductCatalogProduct } from "@/lib/product-catalogs";

type Props = {
  catalog: { id: string } & Partial<ProductCatalogDoc>;
  jobId: string | null;
  backHref: string;
  backLabel: string;
};

export function CustomerCatalogDetailView({ catalog, jobId, backHref, backLabel }: Props) {
  const basePath = useMemo(
    () =>
      jobId
        ? `/portal/customer/jobs/${jobId}/catalogs/${catalog.id}`
        : `/portal/customer/catalogs/${catalog.id}`,
    [jobId, catalog.id]
  );

  const products = useMemo(() => {
    return [...(catalog.products ?? [])]
      .filter((p) => p && p.active !== false && p.archived !== true)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [catalog.products]);

  const cover = catalog.coverImageUrl;
  const intro = catalogSubtitleForList(catalog);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-3 py-5 sm:px-4">
      <Button variant="ghost" size="sm" asChild className="gap-1">
        <Link href={backHref}>
          <ChevronLeft className="h-4 w-4" />
          {backLabel}
        </Link>
      </Button>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-card shadow-sm dark:border-slate-700">
        <div className="aspect-[21/9] max-h-52 w-full bg-muted sm:max-h-64">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Bez titulního obrázku
            </div>
          )}
        </div>
        <div className="space-y-3 p-4 sm:p-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              {catalog.name || "Katalog"}
            </h1>
            {catalog.category ? (
              <p className="mt-1 text-sm text-muted-foreground">{catalog.category}</p>
            ) : null}
          </div>
          {catalog.description?.trim() ? (
            <ExpandableDescription text={catalog.description.trim()} collapsedClassName="line-clamp-3" />
          ) : intro ? (
            <p className="text-sm text-muted-foreground">{intro}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Režim výběru: {catalog.selectionMode === "single" ? "jedna položka" : "více položek"}
          </p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Produkty ({products.length})
        </h2>
        <ul className="space-y-2">
          {products.map((p) => (
            <li key={p.id}>
              <CustomerProductCompactRow href={`${basePath}/products/${p.id}`} product={p} />
            </li>
          ))}
        </ul>
        {!products.length ? (
          <p className="text-sm text-muted-foreground">V tomto katalogu zatím nejsou produkty.</p>
        ) : null}
      </div>
    </div>
  );
}
