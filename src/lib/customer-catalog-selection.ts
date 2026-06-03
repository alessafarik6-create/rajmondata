import { collection, doc, getDocs, type Firestore, serverTimestamp, setDoc } from "firebase/firestore";
import { createCustomerActivity } from "@/lib/customer-activity";
import type {
  JobProductSelectionDoc,
  ProductCatalogDoc,
  ProductSelectionSnapshot,
} from "@/lib/product-catalogs";
import {
  completeAutoCustomerTasksByKind,
  completeCustomerTasksByTypes,
  getAssignedProductCatalogsForJob,
  isProductSelectionSatisfiedForUid,
} from "@/lib/customer-job-tasks";

export function getProductCustomerNote(
  existing: (JobProductSelectionDoc & { id?: string }) | undefined,
  productId: string
): string {
  const snap = (existing?.selectedProducts ?? []).find((s) => s.productId === productId);
  return typeof snap?.customerNote === "string" ? snap.customerNote.trim() : "";
}

export function buildProductSelectionSnapshots(
  catalog: { id: string } & Partial<ProductCatalogDoc>,
  selectedIds: string[],
  existing?: (JobProductSelectionDoc & { id: string }) | undefined,
  noteOverrides?: Record<string, string | null | undefined>
): ProductSelectionSnapshot[] {
  const products = [...(catalog.products ?? [])];
  const byId = new Map(products.map((p) => [p.id, p]));
  const existingById = new Map(
    (existing?.selectedProducts ?? []).map((s) => [s.productId, s] as const)
  );
  return selectedIds.map((id) => {
    const p = byId.get(id);
    const prev = existingById.get(id);
    const out: ProductSelectionSnapshot = {
      productId: id,
      productNameSnapshot: p?.name || prev?.productNameSnapshot || id,
    };
    const image = p?.imageUrl || prev?.productImageSnapshot;
    const catalogName = catalog.name || prev?.catalogNameSnapshot || "Katalog";
    const category = p?.category || prev?.categorySnapshot;
    const price =
      typeof p?.price === "number" ? p.price : prev?.priceSnapshot ?? null;
    if (image) out.productImageSnapshot = image;
    if (catalogName) out.catalogNameSnapshot = catalogName;
    if (category) out.categorySnapshot = category;
    if (price != null) out.priceSnapshot = price;

    const override = noteOverrides?.[id];
    const customerNote =
      override !== undefined
        ? (typeof override === "string" ? override.trim() : "")
        : typeof prev?.customerNote === "string"
          ? prev.customerNote.trim()
          : "";
    if (customerNote) out.customerNote = customerNote;

    return out;
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

async function writeSelectionDoc(
  ref: ReturnType<typeof doc>,
  payload: JobProductSelectionDoc
): Promise<void> {
  await setDoc(ref, payload, { merge: true });
}

async function refreshProductSelectionTasks(
  firestore: Firestore,
  companyId: string,
  jobId: string,
  customerUid: string,
  customerId: string | null
): Promise<void> {
  try {
    const catalogsSnap = await getDocs(
      collection(firestore, "companies", companyId, "product_catalogs")
    );
    const catalogs = catalogsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as Array<{ id: string } & Partial<ProductCatalogDoc>>;
    const assigned = getAssignedProductCatalogsForJob(catalogs, jobId, customerId);
    const selSnap = await getDocs(
      collection(firestore, "companies", companyId, "jobs", jobId, "product_catalog_selections")
    );
    const selections = selSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<
      Partial<JobProductSelectionDoc> & { id?: string }
    >;
    if (isProductSelectionSatisfiedForUid(assigned, selections, customerUid)) {
      await completeAutoCustomerTasksByKind(firestore, companyId, jobId, customerUid, [
        "select_products",
      ]);
      await completeCustomerTasksByTypes(firestore, companyId, jobId, customerUid, [
        "select_products",
      ]);
    }
  } catch {
    /* neblokovat uložení výběru */
  }
}

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
    organizationId: companyId,
    jobId,
    customerPortalUid: customerUid,
    customerId: customerId ?? null,
    catalogId: catalog.id,
    selectedProductIds,
    selectedProducts: buildProductSelectionSnapshots(catalog, selectedProductIds, existing),
    selectedBy: "customer",
    selectedByUserId: customerUid,
    selectedAt: serverTimestamp(),
    status: "selected",
    note: existing?.note ?? null,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await writeSelectionDoc(ref, payload);
  await refreshProductSelectionTasks(firestore, companyId, jobId, customerUid, customerId);
}

export type PersistProductNoteParams = {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  customerUid: string;
  customerId: string | null;
  catalog: { id: string } & Partial<ProductCatalogDoc>;
  productId: string;
  productName: string;
  note: string;
  existing?: (JobProductSelectionDoc & { id: string }) | undefined;
};

/** Uloží poznámku k vybranému produktu; aktivitu vytvoří jen při neprázdné změněném textu. */
export async function persistCustomerProductNote(
  params: PersistProductNoteParams
): Promise<{ saved: boolean; activityCreated: boolean }> {
  const {
    firestore,
    companyId,
    jobId,
    customerUid,
    customerId,
    catalog,
    productId,
    productName,
    note,
    existing,
  } = params;

  const trimmed = note.trim();
  const prev = getProductCustomerNote(existing, productId);
  if (trimmed === prev) {
    return { saved: false, activityCreated: false };
  }

  const selectedIds = existing?.selectedProductIds ?? [];
  if (!selectedIds.includes(productId)) {
    return { saved: false, activityCreated: false };
  }

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
    organizationId: companyId,
    jobId,
    customerPortalUid: customerUid,
    customerId: customerId ?? null,
    catalogId: catalog.id,
    selectedProductIds: selectedIds,
    selectedProducts: buildProductSelectionSnapshots(catalog, selectedIds, existing, {
      [productId]: trimmed || null,
    }),
    selectedBy: "customer",
    selectedByUserId: customerUid,
    selectedAt: existing?.selectedAt ?? serverTimestamp(),
    status: existing?.status ?? "selected",
    note: existing?.note ?? null,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await writeSelectionDoc(ref, payload);

  if (!trimmed) {
    return { saved: true, activityCreated: false };
  }

  await createCustomerActivity(firestore, {
    organizationId: companyId,
    jobId,
    customerId: customerId ?? null,
    customerUserId: customerUid,
    type: "customer_note_added",
    title: "Poznámka k produktu",
    message: `Zákazník doplnil poznámku k produktu „${productName || productId}“ v katalogu ${catalog.name || "katalog"}.`,
    createdBy: customerUid,
    createdByRole: "customer",
    isRead: false,
    targetType: "catalog-selection",
    targetId: catalog.id,
    targetLink: `/portal/jobs/${jobId}`,
  });

  return { saved: true, activityCreated: true };
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
