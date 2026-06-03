import { collection, doc, getDocs, type Firestore, serverTimestamp, setDoc } from "firebase/firestore";
import { createCustomerActivity } from "@/lib/customer-activity";
import type {
  JobProductSelectionDoc,
  ProductCatalogDoc,
  ProductCatalogProduct,
  ProductSelectionSnapshot,
} from "@/lib/product-catalogs";
import {
  completeAutoCustomerTasksByKind,
  completeCustomerTasksByTypes,
  getAssignedProductCatalogsForJob,
  isProductSelectionSatisfiedForUid,
} from "@/lib/customer-job-tasks";

function productDisplayName(
  catalog: { id: string } & Partial<ProductCatalogDoc>,
  productId: string,
  existing?: (JobProductSelectionDoc & { id?: string }) | undefined
): string {
  const p = (catalog.products ?? []).find((x) => x.id === productId);
  if (p?.name?.trim()) return p.name.trim();
  const snap = (existing?.selectedProducts ?? []).find((s) => s.productId === productId);
  return (
    snap?.productName?.trim() ||
    snap?.productNameSnapshot?.trim() ||
    productId
  );
}

function selectionDiff(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: next.filter((id) => !prevSet.has(id)),
    removed: prev.filter((id) => !nextSet.has(id)),
  };
}

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
  existing?: (JobProductSelectionDoc & { id?: string }) | undefined,
  noteOverrides?: Record<string, string | null | undefined>
): ProductSelectionSnapshot[] {
  const products = [...(catalog.products ?? [])];
  const byId = new Map(products.map((p) => [p.id, p]));
  const existingById = new Map(
    (existing?.selectedProducts ?? []).map((s) => [s.productId, s] as const)
  );
  const nowIso = new Date().toISOString();

  return selectedIds.map((id) => {
    const p = byId.get(id);
    const prev = existingById.get(id);
    const name = p?.name?.trim() || prev?.productName?.trim() || prev?.productNameSnapshot?.trim() || id;
    const image = p?.imageUrl || p?.gallery?.[0] || prev?.imageUrl || prev?.productImageSnapshot;
    const category = p?.category?.trim() || prev?.categoryId || prev?.categorySnapshot || "";
    const catalogName = catalog.name?.trim() || prev?.catalogNameSnapshot || "Katalog";
    const price =
      typeof p?.price === "number" ? p.price : prev?.priceSnapshot ?? null;

    const override = noteOverrides?.[id];
    const customerNote =
      override !== undefined
        ? typeof override === "string"
          ? override.trim()
          : ""
        : typeof prev?.customerNote === "string"
          ? prev.customerNote.trim()
          : "";

    const keptSelectedAt = prev?.selectedAt;
    const selectedAt =
      keptSelectedAt != null && keptSelectedAt !== ""
        ? keptSelectedAt
        : nowIso;

    const out: ProductSelectionSnapshot = {
      productId: id,
      productNameSnapshot: name,
      productName: name,
      catalogId: catalog.id,
      catalogNameSnapshot: catalogName,
      selectedAt,
    };
    if (image) {
      out.productImageSnapshot = image;
      out.imageUrl = image;
    }
    if (category) {
      out.categorySnapshot = category;
      out.categoryId = category;
    }
    if (price != null) out.priceSnapshot = price;
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

async function logSelectionToggleActivities(params: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  customerId: string | null;
  customerUid: string;
  catalog: { id: string } & Partial<ProductCatalogDoc>;
  existing?: (JobProductSelectionDoc & { id: string }) | undefined;
  prevIds: string[];
  nextIds: string[];
}): Promise<void> {
  const { added, removed } = selectionDiff(params.prevIds, params.nextIds);
  const catalogLabel = params.catalog.name?.trim() || "katalog";

  for (const productId of added) {
    const name = productDisplayName(params.catalog, productId, params.existing);
    await createCustomerActivity(params.firestore, {
      organizationId: params.companyId,
      jobId: params.jobId,
      customerId: params.customerId,
      customerUserId: params.customerUid,
      type: "customer_product_selected",
      title: "Produkt vybrán",
      message: `Zákazník vybral produkt „${name}“ v katalogu ${catalogLabel}.`,
      createdBy: params.customerUid,
      createdByRole: "customer",
      isRead: false,
      targetType: "catalog-selection",
      targetId: params.catalog.id,
      targetLink: `/portal/jobs/${params.jobId}`,
    });
  }

  for (const productId of removed) {
    const name = productDisplayName(params.catalog, productId, params.existing);
    await createCustomerActivity(params.firestore, {
      organizationId: params.companyId,
      jobId: params.jobId,
      customerId: params.customerId,
      customerUserId: params.customerUid,
      type: "customer_product_deselected",
      title: "Produkt odznačen",
      message: `Zákazník odznačil produkt „${name}“ v katalogu ${catalogLabel}.`,
      createdBy: params.customerUid,
      createdByRole: "customer",
      isRead: false,
      targetType: "catalog-selection",
      targetId: params.catalog.id,
      targetLink: `/portal/jobs/${params.jobId}`,
    });
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
  const prevIds = existing?.selectedProductIds ?? [];
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
  await logSelectionToggleActivities({
    firestore,
    companyId,
    jobId,
    customerId,
    customerUid,
    catalog,
    existing,
    prevIds,
    nextIds: selectedProductIds,
  });
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

/** Uloží poznámku k vybranému produktu; aktivitu vytvoří jen při změně textu (ne prázdná→prázdná). */
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

  const hadChange = trimmed !== prev;
  const shouldNotify = hadChange && (trimmed.length > 0 || prev.length > 0);
  if (!shouldNotify) {
    return { saved: true, activityCreated: false };
  }

  await createCustomerActivity(firestore, {
    organizationId: companyId,
    jobId,
    customerId: customerId ?? null,
    customerUserId: customerUid,
    type: "customer_product_selection_updated",
    title: trimmed ? "Poznámka k produktu" : "Poznámka odstraněna",
    message: trimmed
      ? `Zákazník ${prev ? "upravil" : "doplnil"} poznámku k produktu „${productName || productId}“ v katalogu ${catalog.name || "katalog"}.`
      : `Zákazník odstranil poznámku u produktu „${productName || productId}“ v katalogu ${catalog.name || "katalog"}.`,
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

export function findCatalogProduct(
  catalog: { id: string } & Partial<ProductCatalogDoc>,
  productId: string
): ProductCatalogProduct | undefined {
  return (catalog.products ?? []).find((p) => p.id === productId);
}
