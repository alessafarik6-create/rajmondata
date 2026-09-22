/**
 * Uživatelské preference portálu (users/{uid}).
 */
export type PortalUserPreferences = {
  aiSecretaryCollapsed?: boolean;
  dashboardModuleOrder?: string[];
};

export function parsePortalUserPreferences(
  raw: Record<string, unknown> | null | undefined
): PortalUserPreferences {
  if (!raw) return {};
  const prefs =
    raw.portalPreferences && typeof raw.portalPreferences === "object"
      ? (raw.portalPreferences as Record<string, unknown>)
      : raw;

  const out: PortalUserPreferences = {};

  if (typeof prefs.aiSecretaryCollapsed === "boolean") {
    out.aiSecretaryCollapsed = prefs.aiSecretaryCollapsed;
  }

  const order = prefs.dashboardModuleOrder;
  if (Array.isArray(order)) {
    out.dashboardModuleOrder = order.filter((k) => typeof k === "string" && k.trim()).map(String);
  }

  return out;
}

/** Sloučí uložené pořadí s aktuálně viditelnými moduly. */
export function normalizeDashboardModuleOrder(
  saved: string[] | undefined,
  visibleKeys: string[]
): string[] {
  const visibleSet = new Set(visibleKeys);
  const out: string[] = [];
  for (const k of saved ?? []) {
    if (visibleSet.has(k) && !out.includes(k)) out.push(k);
  }
  for (const k of visibleKeys) {
    if (!out.includes(k)) out.push(k);
  }
  return out;
}
