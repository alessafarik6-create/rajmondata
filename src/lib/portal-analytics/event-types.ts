/** Typované sémantické události portálu (bez obsahu formulářů). */
export const PORTAL_ANALYTICS_EVENT_NAMES = [
  "login",
  "logout",
  "module_opened",
  "action_clicked",
  "job_created",
  "job_status_changed",
  "lead_created",
  "offer_created",
  "invoice_issued",
  "document_uploaded",
  "ai_feature_used",
  "attendance_terminal_used",
  "reports_opened",
  "form_started",
  "form_completed",
  "form_abandoned",
  "dead_click",
  "flow_abandoned",
] as const;

export type PortalAnalyticsEventName = (typeof PORTAL_ANALYTICS_EVENT_NAMES)[number];

export type PortalAnalyticsDeviceClass = "desktop" | "mobile" | "tablet" | "unknown";

export function isPortalAnalyticsEventName(raw: string): raw is PortalAnalyticsEventName {
  return (PORTAL_ANALYTICS_EVENT_NAMES as readonly string[]).includes(raw);
}

/** Bezpečný klíč modulu — bez query stringů a tokenů. */
export function sanitizePortalAnalyticsModuleId(raw: string | null | undefined): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_/-]/g, "")
    .slice(0, 64);
  return s || "unknown";
}

export function mapPathToAnalyticsModule(pathname: string): string {
  const path = String(pathname ?? "").trim() || "/";
  if (!path.startsWith("/portal")) return "public";
  if (path.startsWith("/portal/dashboard")) return "overview";
  if (path.startsWith("/portal/employees")) return "employees";
  if (path.startsWith("/portal/jobs")) return "jobs";
  if (path.startsWith("/portal/leads")) return "leads";
  if (path.startsWith("/portal/offers")) return "offers";
  if (path.startsWith("/portal/invoices")) return "invoices";
  if (path.startsWith("/portal/finance")) return "finance";
  if (path.startsWith("/portal/bank")) return "bank";
  if (path.startsWith("/portal/documents")) return "documents";
  if (path.startsWith("/portal/sklad")) return "sklad";
  if (path.startsWith("/portal/vyroba")) return "vyroba";
  if (path.startsWith("/portal/ai-center")) return "aiCenter";
  if (path.startsWith("/portal/labor") || path.includes("/attendance")) return "labor";
  if (path.startsWith("/portal/report")) return "reports";
  if (path.startsWith("/portal/settings")) return "settings";
  if (path.startsWith("/portal/customers")) return "customers";
  if (path.startsWith("/portal/schedule")) return "schedule";
  return sanitizePortalAnalyticsModuleId(path.replace(/^\/portal\/?/, "").split("/")[0] || "overview");
}
