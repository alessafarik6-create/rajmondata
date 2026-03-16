/**
 * Firestore collection names used across the app.
 * - Organisations (Czech: společnosti): used by superadmin dashboard and registration.
 * - Companies (portal tenant root): same org doc is written here for portal compatibility; subcollections (employees, jobs, etc.) live under companies/{companyId}/...
 */
export const ORGANIZATIONS_COLLECTION = "společnosti";
export const COMPANIES_COLLECTION = "companies";
export const USERS_COLLECTION = "users";
