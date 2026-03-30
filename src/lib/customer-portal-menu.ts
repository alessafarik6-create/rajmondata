/**
 * Levé menu klientského portálu — pouze role `customer`.
 * Oddělené od PORTAL_SIDEBAR_MENU_DEFS (firemní moduly, doklady, finance).
 */

export type CustomerPortalMenuItem = {
  id: string;
  label: string;
  href: string;
};

export const CUSTOMER_PORTAL_MENU_ITEMS: readonly CustomerPortalMenuItem[] = [
  { id: "customer-home", label: "Přehled", href: "/portal/customer" },
  { id: "customer-jobs", label: "Moje zakázky", href: "/portal/customer/jobs" },
  { id: "customer-profile", label: "Profil", href: "/portal/customer/profile" },
];
