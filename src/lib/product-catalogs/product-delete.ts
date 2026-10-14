import type { ProductCatalogProduct } from "@/lib/product-catalogs";
import { buildProductGalleryUrls } from "@/lib/product-catalogs";

/** Cesta objektu ve Firebase Storage z download URL (gs/https). */
export function firebaseStorageObjectPathFromDownloadUrl(url: string): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    return raw.replace(/^\/+/, "");
  }
  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/o/");
    if (parts.length >= 2) {
      const encoded = parts[1]?.split("?")[0] ?? "";
      if (encoded) return decodeURIComponent(encoded);
    }
  } catch {
    return null;
  }
  return null;
}

export type ProductDeletePlan =
  | { mode: "remove"; products: ProductCatalogProduct[] }
  | { mode: "archive"; products: ProductCatalogProduct[] };

/**
 * Produkt bez historického výběru odstraní z pole; jinak soft-archivace (zachování snapshotů).
 */
export function planCatalogProductDeletion(
  products: ProductCatalogProduct[],
  productId: string,
  hasHistoricalSelection: boolean
): ProductDeletePlan {
  const list = Array.isArray(products) ? products : [];
  if (hasHistoricalSelection) {
    const next = list.map((p) =>
      p.id === productId
        ? {
            ...p,
            active: false,
            archived: true,
            archivedAt: new Date().toISOString(),
          }
        : p
    );
    return { mode: "archive", products: next };
  }
  return { mode: "remove", products: list.filter((p) => p.id !== productId) };
}

export function collectProductImageStoragePaths(product: ProductCatalogProduct): string[] {
  const paths = new Set<string>();
  for (const url of buildProductGalleryUrls(product)) {
    const path = firebaseStorageObjectPathFromDownloadUrl(url);
    if (path) paths.add(path);
  }
  return [...paths];
}
