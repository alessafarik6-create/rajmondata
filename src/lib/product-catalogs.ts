export type ProductCatalogSelectionMode = "single" | "multi";
export type ProductCatalogSelectionStatus = "draft" | "submitted" | "confirmed";

export type ProductCatalogProduct = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  gallery?: string[];
  price?: number | null;
  note?: string;
  category?: string;
  order?: number;
  active?: boolean;
  variants?: string[];
};

export type ProductCatalogDoc = {
  companyId: string;
  name: string;
  description?: string;
  category?: string;
  active: boolean;
  customerVisible: boolean;
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
  selectedAt?: unknown;
  selectedBy: string;
  note?: string | null;
  status: ProductCatalogSelectionStatus;
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

