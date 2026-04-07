export type ProductCatalogSelectionMode = "single" | "multi";
export type ProductCatalogSelectionStatus = "draft" | "submitted" | "confirmed";
export type ProductSelectionSnapshot = {
  productId: string;
  productNameSnapshot: string;
  productImageSnapshot?: string;
  catalogNameSnapshot?: string;
  categorySnapshot?: string;
  priceSnapshot?: number | null;
};

export type ProductCatalogProduct = {
  id: string;
  name: string;
  /** Krátký text pro seznamy u zákazníka; bez něj se použije zkrácený popis. */
  shortDescription?: string;
  description?: string;
  /** Hlavní náhled; starší data mohou mít jen imageUrl bez gallery. */
  imageUrl?: string;
  /** Všechny obrázky produktu (URL z Firebase Storage). */
  gallery?: string[];
  price?: number | null;
  note?: string;
  internalNote?: string;
  category?: string;
  order?: number;
  active?: boolean;
  archived?: boolean;
  archivedAt?: unknown;
  variants?: string[];
};

/**
 * Sestaví seznam URL obrázků z dokumentu produktu (imageUrl + gallery, bez duplicit).
 */
export function buildProductGalleryUrls(p: ProductCatalogProduct): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (u: string | undefined) => {
    const t = typeof u === "string" ? u.trim() : "";
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  push(p.imageUrl);
  for (const u of p.gallery ?? []) push(u);
  return out;
}

/**
 * Firestore nepřijímá `undefined` uvnitř map v poli `products` — serializace bez undefined.
 */
export function serializeProductForFirestore(p: ProductCatalogProduct): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: p.id,
    name: (p.name ?? "").trim() || "Produkt",
    order: typeof p.order === "number" && Number.isFinite(p.order) ? p.order : 0,
    active: p.active !== false,
    archived: p.archived === true,
  };
  if (p.archived === true && p.archivedAt !== undefined && p.archivedAt !== null) {
    out.archivedAt = p.archivedAt;
  }

  const shortDescription = typeof p.shortDescription === "string" ? p.shortDescription.trim() : "";
  if (shortDescription) out.shortDescription = shortDescription;

  const description = typeof p.description === "string" ? p.description.trim() : "";
  if (description) out.description = description;

  const category = typeof p.category === "string" ? p.category.trim() : "";
  if (category) out.category = category;

  if (typeof p.price === "number" && Number.isFinite(p.price)) {
    out.price = p.price;
  } else if (p.price === null) {
    out.price = null;
  }

  const note = typeof p.note === "string" ? p.note.trim() : "";
  if (note) out.note = note;

  const internalNote = typeof p.internalNote === "string" ? p.internalNote.trim() : "";
  if (internalNote) out.internalNote = internalNote;

  const gallery = buildProductGalleryUrls(p).filter((u) => u.length > 0);
  out.gallery = gallery;

  const main = typeof p.imageUrl === "string" ? p.imageUrl.trim() : "";
  if (main) {
    out.imageUrl = main;
  } else if (gallery.length > 0) {
    out.imageUrl = gallery[0];
  }

  if (Array.isArray(p.variants) && p.variants.length > 0) {
    out.variants = p.variants;
  }

  return out;
}

export type ProductCatalogDoc = {
  companyId: string;
  name: string;
  description?: string;
  category?: string;
  coverImageUrl?: string;
  active: boolean;
  customerVisible: boolean;
  order?: number;
  archived?: boolean;
  deletedAt?: unknown;
  selectionMode: ProductCatalogSelectionMode;
  assignedJobIds: string[];
  assignedCustomerIds: string[];
  products: ProductCatalogProduct[];
  createdBy: string;
  createdAt?: unknown;
  updatedBy: string;
  updatedAt?: unknown;
};

export type JobProductSelectionDoc = {
  companyId: string;
  jobId: string;
  customerPortalUid: string;
  customerId?: string | null;
  catalogId: string;
  selectedProductIds: string[];
  selectedProducts?: ProductSelectionSnapshot[];
  selectedAt?: unknown;
  selectedBy: string;
  note?: string | null;
  status: ProductCatalogSelectionStatus;
  confirmedAt?: unknown;
  confirmedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function catalogIsAssignedToJob(
  catalog: Partial<ProductCatalogDoc> | null | undefined,
  jobId: string
): boolean {
  if (!catalog || !jobId) return false;
  const ids = Array.isArray(catalog.assignedJobIds) ? catalog.assignedJobIds : [];
  return ids.includes(jobId);
}

export function catalogIsAssignedToCustomer(
  catalog: Partial<ProductCatalogDoc> | null | undefined,
  customerId: string | null | undefined
): boolean {
  if (!catalog || !customerId) return false;
  const ids = Array.isArray(catalog.assignedCustomerIds) ? catalog.assignedCustomerIds : [];
  return ids.includes(customerId);
}

