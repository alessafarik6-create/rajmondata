import Link from "next/link";
import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductCatalogDoc, ProductCatalogProduct } from "@/lib/product-catalogs";

export function productSubtitleForCustomerList(p: ProductCatalogProduct): string {
  const short = (p.shortDescription ?? "").trim();
  if (short) return short;
  const note = (p.note ?? "").trim();
  if (note) return note.length > 140 ? `${note.slice(0, 137)}…` : note;
  const d = (p.description ?? "").trim();
  if (!d) return "";
  if (d.length <= 120) return d;
  return `${d.slice(0, 117).trim()}…`;
}

export function catalogSubtitleForList(c: Partial<ProductCatalogDoc>): string {
  const d = (c.description ?? "").trim();
  if (!d) return "";
  if (d.length <= 100) return d;
  return `${d.slice(0, 97).trim()}…`;
}

type CatalogRowProps = {
  href: string;
  catalog: { id: string } & Partial<ProductCatalogDoc>;
  className?: string;
};

/** Kompaktní řádek katalogu: miniatura vlevo, text, šipka. */
export function CustomerCatalogCompactRow({ href, catalog, className }: CatalogRowProps) {
  const cover = catalog.coverImageUrl;
  const subtitle = catalogSubtitleForList(catalog);
  return (
    <Link
      href={href}
      className={cn(
        "flex gap-3 rounded-lg border border-slate-200 bg-card p-2.5 transition-colors hover:border-primary/40 hover:bg-muted/40 dark:border-slate-700",
        className
      )}
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted sm:h-16 sm:w-16">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
            Katalog
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="font-semibold leading-snug text-foreground">{catalog.name || "Katalog"}</p>
        {subtitle ? (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {subtitle}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">Zobrazit produkty</p>
        )}
      </div>
      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

type ProductRowProps = {
  href: string;
  product: ProductCatalogProduct;
  className?: string;
  trailing?: React.ReactNode;
};

/** Kompaktní řádek produktu: miniatura, název, krátký popis. */
export function CustomerProductCompactRow({ href, product, className, trailing }: ProductRowProps) {
  const img = product.imageUrl || product.gallery?.[0];
  const sub = productSubtitleForCustomerList(product);
  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border border-slate-200 bg-card p-2 transition-colors dark:border-slate-700",
        className
      )}
    >
      <Link href={href} className="flex min-w-0 flex-1 gap-3 text-left hover:opacity-90">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted sm:h-14 sm:w-14">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
              Foto
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 py-0.5">
          <p className="font-medium leading-snug text-foreground">{product.name || "Produkt"}</p>
          {sub ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {sub}
            </p>
          ) : null}
          {typeof product.price === "number" ? (
            <p className="mt-1 text-xs font-semibold text-primary sm:text-sm">
              {product.price.toLocaleString("cs-CZ")} Kč
            </p>
          ) : null}
        </div>
        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
      {trailing ? <div className="flex shrink-0 flex-col justify-center border-l pl-2">{trailing}</div> : null}
    </div>
  );
}
