import {
  catalogIsAssignedToCustomer,
  catalogIsAssignedToJob,
  type ProductCatalogDoc,
} from "@/lib/product-catalogs";

/** Zda je katalog v administraci označen jako viditelný pro zákazníka (včetně legacy hodnot). */
export function isCatalogCustomerVisibleForPortal(
  catalog: Partial<ProductCatalogDoc> | null | undefined
): boolean {
  if (!catalog) return false;
  const v = catalog.customerVisible as unknown;
  if (v === true) return true;
  if (v === false) return false;
  if (v === "true" || v === 1) return true;
  if (v === "false" || v === 0) return false;
  return false;
}

export function catalogVisibleToCustomer(
  catalog: { id?: string } & Partial<ProductCatalogDoc> | null | undefined,
  opts: { linkedJobIds: string[]; customerRecordId?: string | null }
): boolean {
  if (!catalog) return false;
  if (catalog.active === false) return false;
  if (!isCatalogCustomerVisibleForPortal(catalog)) return false;
  const jobs = opts.linkedJobIds ?? [];
  if (jobs.some((jid) => catalogIsAssignedToJob(catalog, jid))) return true;
  const cid = opts.customerRecordId?.trim();
  if (cid && catalogIsAssignedToCustomer(catalog, cid)) return true;
  return false;
}
