import { getBytes, ref } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import type { ProductCatalogPdfAttachment } from "@/lib/product-catalogs";

export type CatalogPdfLoadSource = "storage" | "downloadUrl";

export class CatalogPdfLoadError extends Error {
  readonly httpStatus?: number;
  readonly source?: CatalogPdfLoadSource;

  constructor(message: string, opts?: { httpStatus?: number; source?: CatalogPdfLoadSource }) {
    super(message);
    this.name = "CatalogPdfLoadError";
    this.httpStatus = opts?.httpStatus;
    this.source = opts?.source;
  }
}

/** Načte PDF bajty — preferuje Firebase Storage SDK (auth), fallback download URL. */
export async function loadCatalogPdfBytes(
  att: Pick<ProductCatalogPdfAttachment, "storagePath" | "downloadUrl">
): Promise<{ data: Uint8Array; source: CatalogPdfLoadSource }> {
  const path = typeof att.storagePath === "string" ? att.storagePath.trim() : "";
  if (path) {
    try {
      const buf = await getBytes(ref(getFirebaseStorage(), path));
      return { data: new Uint8Array(buf), source: "storage" };
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "storage/unauthorized" || code === "storage/object-not-found") {
        throw new CatalogPdfLoadError(
          code === "storage/object-not-found"
            ? "PDF soubor ve Storage nebyl nalezen."
            : "Nemáte oprávnění načíst tento PDF soubor.",
          { source: "storage" }
        );
      }
    }
  }

  const url = typeof att.downloadUrl === "string" ? att.downloadUrl.trim() : "";
  if (!url) {
    throw new CatalogPdfLoadError("PDF nemá uloženou cestu ani odkaz ke stažení.");
  }
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) {
    throw new CatalogPdfLoadError(`PDF nelze stáhnout (HTTP ${res.status}).`, {
      httpStatus: res.status,
      source: "downloadUrl",
    });
  }
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.length < 5 || data[0] !== 0x25 || data[1] !== 0x50) {
    throw new CatalogPdfLoadError("Stažený soubor není platné PDF.");
  }
  return { data, source: "downloadUrl" };
}

export async function createCatalogPdfBlobUrl(
  att: Pick<ProductCatalogPdfAttachment, "storagePath" | "downloadUrl">
): Promise<string> {
  const { data } = await loadCatalogPdfBytes(att);
  const blob = new Blob([data], { type: "application/pdf" });
  return URL.createObjectURL(blob);
}

export function catalogPdfCacheKey(att: Pick<ProductCatalogPdfAttachment, "id" | "storagePath">): string {
  const path = att.storagePath?.trim();
  if (path) return path;
  return `id:${att.id}`;
}
