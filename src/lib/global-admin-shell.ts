/**
 * Globální administrace (/admin, cookie session) nesmí záviset na Firestore stavu konkrétní organizace
 * (moduly, licence). Tenant dokumenty firmy se na těchto cestách neodbavují — viz `useCompany`.
 */
export function isGlobalAdminAppPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname.startsWith("/admin") && pathname !== "/admin/login";
}
