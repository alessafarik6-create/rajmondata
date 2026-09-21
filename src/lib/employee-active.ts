/**
 * Aktivní zaměstnanec organizace — jednotná logika napříč portálem.
 * Primární pole: `isActive` (false = neaktivní). Chybějící pole = aktivní (zpětná kompatibilita).
 */

export type EmployeeActiveFields = {
  id?: string;
  isActive?: boolean | null;
  /** legacy / jiné zápisy */
  active?: boolean | null;
  deletedAt?: unknown;
  archived?: boolean | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  companyName?: string | null;
  displayName?: string | null;
  name?: string | null;
};

export function isEmployeeActive(
  employee: EmployeeActiveFields | null | undefined
): boolean {
  if (!employee) return false;
  if (employee.deletedAt != null && String(employee.deletedAt).trim() !== "") {
    return false;
  }
  if (employee.archived === true) return false;
  if (employee.isActive === false) return false;
  if (employee.active === false) return false;
  return true;
}

export function filterActiveEmployees<T extends EmployeeActiveFields>(
  employees: readonly T[] | null | undefined
): T[] {
  if (!employees?.length) return [];
  return employees.filter(isEmployeeActive);
}

/** Výběry pro nové přiřazení — aktivní + volitelně konkrétní ID (např. již vybraný neaktivní v historii). */
export function filterEmployeesForAssignment<T extends EmployeeActiveFields>(
  employees: readonly T[] | null | undefined,
  opts?: { alsoIncludeIds?: Iterable<string | null | undefined> }
): T[] {
  if (!employees?.length) return [];
  const extra = new Set<string>();
  if (opts?.alsoIncludeIds) {
    for (const raw of opts.alsoIncludeIds) {
      const id = String(raw ?? "").trim();
      if (id) extra.add(id);
    }
  }
  return employees.filter((e) => {
    const id = String((e as { id?: string }).id ?? "").trim();
    if (id && extra.has(id)) return true;
    return isEmployeeActive(e);
  });
}

export function formatEmployeeDisplayName(
  employee: EmployeeActiveFields | null | undefined,
  fallbackId?: string
): string {
  if (!employee) return fallbackId?.trim() || "Zaměstnanec";
  const company = String(employee.companyName ?? "").trim();
  if (company) return company;
  const fromParts = [employee.firstName, employee.lastName]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (fromParts) return fromParts;
  const dn = String(employee.displayName ?? employee.name ?? employee.email ?? "").trim();
  if (dn) return dn;
  return fallbackId?.trim() || String((employee as { id?: string }).id ?? "").trim() || "Zaměstnanec";
}

export function formatEmployeeLabelWithInactiveState(
  employee: EmployeeActiveFields | null | undefined,
  fallbackId?: string
): string {
  const base = formatEmployeeDisplayName(employee, fallbackId);
  if (employee && !isEmployeeActive(employee)) {
    return `${base} · Neaktivní`;
  }
  return base;
}
