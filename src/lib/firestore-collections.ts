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
