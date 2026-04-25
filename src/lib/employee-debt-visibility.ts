/**
 * Zda má zaměstnanec v portálu vidět vlastní dluhy (pouze čtení).
 * Výchozí: ano, dokud administrátor explicitně nevypne (`allowEmployeeDebtSelfView === false`).
 */
export function employeeDebtSelfViewAllowed(company: unknown): boolean {
  const c = company as Record<string, unknown> | null | undefined;
  if (!c) return true;
  if (c.allowEmployeeDebtSelfView === false) return false;
  const s = c.settings;
  if (s && typeof s === "object" && s !== null) {
    if ((s as Record<string, unknown>).allowEmployeeDebtSelfView === false) {
      return false;
    }
  }
  return true;
}
