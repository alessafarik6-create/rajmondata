import { doc, type Firestore, serverTimestamp, setDoc } from "firebase/firestore";
import { createCustomerActivity } from "@/lib/customer-activity";
import type {
  JobProductSelectionDoc,
  ProductCatalogDoc,
  ProductSelectionSnapshot,
} from "@/lib/product-catalogs";

export function buildProductSelectionSnapshots(
  catalog: { id: string } & Partial<ProductCatalogDoc>,
  selectedIds: string[],
  existing?: (JobProductSelectionDoc & { id: string }) | undefined
): ProductSelectionSnapshot[] {
  const products = [...(catalog.products ?? [])];
  const byId = new Map(products.map((p) => [p.id, p]));
  const existingById = new Map(
    (existing?.selectedProducts ?? []).map((s) => [s.productId, s] as const)
  );
  return selectedIds.map((id) => {
    const p = byId.get(id);
    const prev = existingById.get(id);
    return {
      productId: id,
      productNameSnapshot: p?.name || prev?.productNameSnapshot || id,
      productImageSnapshot: p?.imageUrl || prev?.productImageSnapshot,
      catalogNameSnapshot: catalog.name || prev?.catalogNameSnapshot || "Katalog",
      categorySnapshot: p?.category || prev?.categorySnapshot,
      priceSnapshot: typeof p?.price === "number" ? p.price : prev?.priceSnapshot ?? null,
    };
  });
}

export type PersistSelectionParams = {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  customerUid: string;
  customerId: string | null;
  catalog: { id: string } & Partial<ProductCatalogDoc>;
  selectedProductIds: string[];
  existing?: (JobProductSelectionDoc & { id: string }) | undefined;
};

export async function persistCustomerCatalogSelection(
  params: PersistSelectionParams
): Promise<void> {
  const {
    firestore,
    companyId,
    jobId,
    customerUid,
    customerId,
    catalog,
    selectedProductIds,
    existing,
  } = params;
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
  const payload: JobProductSelectionDoc = {
    companyId,
    jobId,
    customerPortalUid: customerUid,
    customerId: customerId ?? null,
    catalogId: catalog.id,
    selectedProductIds,
    selectedProducts: buildProductSelectionSnapshots(catalog, selectedProductIds, existing),
    selectedBy: customerUid,
    selectedAt: serverTimestamp(),
    status: "submitted",
    note: existing?.note ?? null,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload, { merge: true });
  await createCustomerActivity(firestore, {
    organizationId: companyId,
    jobId,
    customerId: customerId ?? null,
    customerUserId: customerUid,
    type: existing ? "customer_product_selection_updated" : "customer_product_selected",
    title: "Výběr produktů",
    message: `Zákazník upravil výběr v katalogu ${catalog.name || "katalog"}.`,
    createdBy: customerUid,
    createdByRole: "customer",
    isRead: false,
    targetType: "catalog-selection",
    targetId: catalog.id,
    targetLink: `/portal/jobs/${jobId}`,
  });
}

export function computeToggledSelection(
  catalog: Partial<ProductCatalogDoc>,
  productId: string,
  existingIds: string[]
): string[] {
  const mode = catalog.selectionMode === "single" ? "single" : "multi";
  const prev = new Set(existingIds);
  if (mode === "single") {
    if (prev.has(productId)) return [];
    return [productId];
  }
  if (prev.has(productId)) {
    prev.delete(productId);
  } else {
    prev.add(productId);
  }
  return Array.from(prev);
}
