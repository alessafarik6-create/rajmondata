import {
  filterEmployeesForAssignment,
  formatPortalEmployeeListName,
  type EmployeeActiveFields,
} from "@/lib/employee-active";

export type PreliminaryDealEmployeeOption = { id: string; name: string };

export function mapEmployeesToPreliminaryDealOptions(
  raw: readonly (EmployeeActiveFields & { id?: string })[] | null | undefined,
  opts?: { alsoIncludeIds?: Iterable<string | null | undefined> }
): PreliminaryDealEmployeeOption[] {
  const rows = (raw ?? []).map((r) => ({
    ...r,
    id: String((r as { id?: string }).id ?? "").trim(),
  }));
  const eligible = filterEmployeesForAssignment(rows, {
    alsoIncludeIds: opts?.alsoIncludeIds,
  });
  return eligible
    .map((row) => {
      const id = String((row as { id?: string }).id ?? "").trim();
      if (!id) return null;
      return { id, name: formatPortalEmployeeListName(row, id) };
    })
    .filter((x): x is PreliminaryDealEmployeeOption => x != null)
    .sort((a, b) => a.name.localeCompare(b.name, "cs"));
}

export function buildEmployeeNameMap(
  options: PreliminaryDealEmployeeOption[]
): Map<string, string> {
  return new Map(options.map((e) => [e.id, e.name]));
}

export function resolvePreliminaryDealResponsibleName(
  deal: { responsibleEmployeeId?: string | null; responsibleEmployeeName?: string | null },
  nameByEmployeeId: Map<string, string>
): string {
  const id = deal.responsibleEmployeeId?.trim();
  if (id && nameByEmployeeId.has(id)) return nameByEmployeeId.get(id)!;
  const stored = deal.responsibleEmployeeName?.trim();
  if (stored && stored !== "Zaměstnanec") return stored;
  if (id) return formatPortalEmployeeListName(null, id);
  return "—";
}

export function enrichPreliminaryDealRowResponsibleName<
  T extends {
    responsibleEmployeeId?: string | null;
    responsibleEmployeeName?: string | null;
  },
>(row: T, nameByEmployeeId: Map<string, string>): T {
  const name = resolvePreliminaryDealResponsibleName(row, nameByEmployeeId);
  if (name === "—") return row;
  return { ...row, responsibleEmployeeName: name };
}
