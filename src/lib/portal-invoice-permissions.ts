/** Oprávnění k fakturám v portálu — sdílené UI a API. */

export function canManagePortalInvoices(role: string): boolean {
  return ["owner", "admin", "manager", "accountant"].includes(String(role ?? "").trim());
}

export function canViewPortalInvoices(role: string): boolean {
  const r = String(role ?? "").trim();
  if (canManagePortalInvoices(r)) return true;
  return ["employee", "customer"].includes(r);
}
