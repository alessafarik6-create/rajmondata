/**
 * Firestore collection names used across the app.
 * - Organisations (Czech: společnosti): used by superadmin dashboard and registration.
 * - Companies (portal tenant root): same org doc is written here for portal compatibility; subcollections (employees, jobs, etc.) live under companies/{companyId}/...
 */
export const ORGANIZATIONS_COLLECTION = "společnosti";
export const COMPANIES_COLLECTION = "companies";
export const USERS_COLLECTION = "users";

/** Globální správa platformy (superadmin přes Admin SDK). */
export const PLATFORM_SETTINGS_COLLECTION = "platform_settings";
export const PLATFORM_MODULES_COLLECTION = "platform_modules";
export const PLATFORM_SEO_COLLECTION = "platform_seo";
/** Faktury provozovatele platformy vůči organizacím (zápis jen Admin SDK). */
export const PLATFORM_INVOICES_COLLECTION = "platform_invoices";
export const COMPANY_LICENSES_COLLECTION = "company_licenses";

/** Položky nápovědy portálu (globální nebo per firma). */
export const HELP_CONTENT_COLLECTION = "helpContent";

/** Dotazy organizací na provozovatele platformy (zápis přes API / Admin SDK). */
export const SUPPORT_TICKETS_COLLECTION = "supportTickets";

/** Globální notifikace pro superadministrátora platformy (zápis jen Admin SDK). */
export const PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION = "platform_admin_notifications";

/** Kampaně / zprávy superadmina směrem k organizacím (Admin SDK). */
export const PLATFORM_ORG_CAMPAIGNS_COLLECTION = "platform_org_campaigns";

/** Doručené kampaně v portálu organizace: companies/{id}/platform_campaign_inbox/{campaignId}. */
export const PLATFORM_CAMPAIGN_INBOX_SUBCOLLECTION = "platform_campaign_inbox";

/** Agregovaná denní analytika veřejného webu (bez PII). */
export const PLATFORM_ANALYTICS_DAILY_COLLECTION = "platform_analytics_daily";
/** Unikátní návštěvníci / den — doc id = `{date}_{visitorHash}`. */
export const PLATFORM_ANALYTICS_UNIQUE_DAILY_COLLECTION = "platform_analytics_unique_daily";

/** Agregované bezpečnostní incidenty (ne jeden záznam na HTTP request). */
export const PLATFORM_SECURITY_INCIDENTS_COLLECTION = "platform_security_incidents";
/** Denní agregace bezpečnostních metrik pro grafy. */
export const PLATFORM_SECURITY_DAILY_COLLECTION = "platform_security_daily";
/** Cooldown / deduplikace bezpečnostních e-mailů. */
export const PLATFORM_SECURITY_ALERT_STATE_COLLECTION = "platform_security_alert_state";
/** Audit citlivých akcí superadmina. */
export const PLATFORM_SECURITY_AUDIT_COLLECTION = "platform_security_audit";
/** Globální mapování veřejného QR tokenu → company/job/task (Admin SDK). */
export const PRODUCTION_QR_TOKEN_INDEX_COLLECTION = "production_qr_token_index";

/** Distribuovaný rate limit (Firestore). */
export const PLATFORM_RATE_LIMITS_COLLECTION = "platform_rate_limits";

/** Agregovaná denní analytika firemního portálu (globální souhrn, bez PII). */
export const PLATFORM_PORTAL_ANALYTICS_GLOBAL_DAILY_COLLECTION =
  "platform_portal_analytics_global_daily";
/** Agregace portálu per organizace / den — doc id `{yyyy-mm-dd}_{organizationId}`. */
export const PLATFORM_PORTAL_ANALYTICS_ORG_DAILY_COLLECTION =
  "platform_portal_analytics_org_daily";
/** Dedup klíče událostí (krátká retence, aby se nepočítaly duplicity). */
export const PLATFORM_PORTAL_ANALYTICS_DEDUP_COLLECTION = "platform_portal_analytics_dedup";
/** Prahové hodnoty skóre, retence, alerty — doc `default`. */
export const PLATFORM_PORTAL_ANALYTICS_SETTINGS_COLLECTION =
  "platform_portal_analytics_settings";
/** Vygenerovaná upozornění pro superadmina (cron, ne při každém načtení UI). */
export const PLATFORM_PORTAL_ANALYTICS_ALERTS_COLLECTION =
  "platform_portal_analytics_alerts";
/** Audit přístupu superadmina k detailní analytice organizace. */
export const PLATFORM_PORTAL_ANALYTICS_AUDIT_COLLECTION =
  "platform_portal_analytics_audit";
