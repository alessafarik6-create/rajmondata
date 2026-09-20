/** Identifikátory dashboard boxů (pořadí ukládáno per user + organizace). */
export type DashboardWidgetId =
  | "emails"
  | "jobs"
  | "leads"
  | "documentsToPay"
  | "calendar"
  | "tasks"
  | "labor"
  | "offers"
  | "messages"
  | "warehouse"
  | "production"
  | "fleet"
  | "pendingDocuments"
  | "activity";

export const DEFAULT_DASHBOARD_WIDGET_ORDER: DashboardWidgetId[] = [
  "emails",
  "jobs",
  "leads",
  "documentsToPay",
  "calendar",
  "tasks",
  "labor",
  "offers",
  "messages",
  "warehouse",
  "production",
  "fleet",
  "pendingDocuments",
  "activity",
];

const VALID = new Set<string>(DEFAULT_DASHBOARD_WIDGET_ORDER);

export function normalizeDashboardWidgetOrder(raw: unknown): DashboardWidgetId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_DASHBOARD_WIDGET_ORDER];
  const seen = new Set<string>();
  const out: DashboardWidgetId[] = [];
  for (const id of raw) {
    const s = String(id ?? "").trim();
    if (!VALID.has(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s as DashboardWidgetId);
  }
  for (const id of DEFAULT_DASHBOARD_WIDGET_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

export function dashboardLayoutDocId(userId: string, companyId: string): string {
  return `${userId}_${companyId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}
