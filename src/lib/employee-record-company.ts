/**
 * Zaměstnanec v companies/{companyId}/employees/{id} nemusí mít vyplněné companyId —
 * dokument pod cestou firmy je platný. Prázdné pole = patří rodičovské firmě.
 */
export function employeeRecordCompanyId(
  emp: Record<string, unknown> | null | undefined
): string {
  if (!emp) return "";
  return String(emp.companyId ?? emp.organizationId ?? "").trim();
}

export function employeeRecordBelongsToCompany(
  emp: Record<string, unknown>,
  companyId: string
): boolean {
  const cid = String(companyId || "").trim();
  if (!cid) return false;
  const stored = employeeRecordCompanyId(emp);
  if (!stored) return true;
  return stored === cid;
}
