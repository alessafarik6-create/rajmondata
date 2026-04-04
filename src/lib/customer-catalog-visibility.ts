import {
  catalogIsAssignedToCustomer,
  catalogIsAssignedToJob,
  type ProductCatalogDoc,
} from "@/lib/product-catalogs";

export function catalogVisibleToCustomer(
  catalog: { id?: string } & Partial<ProductCatalogDoc> | null | undefined,
  opts: { linkedJobIds: string[]; customerRecordId?: string | null }
): boolean {
  if (!catalog) return false;
  if (catalog.active === false) return false;
  if (catalog.customerVisible !== true) return false;
  const jobs = opts.linkedJobIds ?? [];
  if (jobs.some((jid) => catalogIsAssignedToJob(catalog, jid))) return true;
  const cid = opts.customerRecordId?.trim();
  if (cid && catalogIsAssignedToCustomer(catalog, cid)) return true;
  return false;
}
