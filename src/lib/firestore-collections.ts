/**
 * Firestore collection names used across the app.
 * - Organisations (Czech: společnosti): used by superadmin dashboard and registration.
 * - Companies (portal tenant root): same org doc is written here for portal compatibility; subcollections (employees, jobs, etc.) live under companies/{companyId}/...
 */
export const ORGANIZATIONS_COLLECTION = "společnosti";
export const COMPANIES_COLLECTION = "companies";
export const USERS_COLLECTION = "users";

/** Veřejný terminál — aktivní záznam s `ID společnosti` (viz resolve v terminal-company-resolve). */
export const TERMINAL_LINKS_COLLECTION = "terminálOdkazy";

/** Pole dokumentu v terminálOdkazy */
export const TERMINAL_LINK_ACTIVE_FIELD = "aktivní";
export const TERMINAL_LINK_COMPANY_ID_FIELD = "ID společnosti";
