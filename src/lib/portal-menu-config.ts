/**
 * Centrální mapování: licence (kanonické klíče) ↔ položky levého menu firemního portálu.
 * `terminal` zůstává v licenci pro přístup k `/attendance-login`, ale nikdy nemá vlastní řádek v sidebaru.
 */

import type { PlatformModuleCode } from "@/lib/platform-config";
import {
  CANONICAL_MODULE_KEYS,
  type CanonicalModuleKey,
  MODULE_DEFINITIONS,
} from "@/lib/license-modules";

/** Klíče z licence, které se v sidebaru nevykreslují jako modul (pouze interní / access). */
export const LICENSE_KEYS_EXCLUDED_FROM_SIDEBAR: readonly CanonicalModuleKey[] = ["terminal"];

export const hiddenBecauseNotSidebarModule: readonly CanonicalModuleKey[] =
  LICENSE_KEYS_EXCLUDED_FROM_SIDEBAR;

/** Kanonické klíče modulů, které mohou mít vlastní řádek nebo děti v sidebaru. */
export const SIDEBAR_LICENSE_MODULE_KEYS = CANONICAL_MODULE_KEYS.filter(
  (k) => !LICENSE_KEYS_EXCLUDED_FROM_SIDEBAR.includes(k)
) as Exclude<CanonicalModuleKey, "terminal">[];

export type PortalSidebarMenuItemType = "system" | "module" | "child";

/**
 * Jedna položka menu (bez ikony — ikony mapuje `bizforge-sidebar`).
 */
export type PortalSidebarMenuDef = {
  id: string;
  type: PortalSidebarMenuItemType;
  label: string;
  href: string;
  roles: readonly string[];
  /**
   * Pro `module`: alespoň jeden klíč musí být true v `effectiveModules`.
   * `terminal` sem nikdy nepatří — není v sidebaru.
   */
  licenseKeys?: readonly CanonicalModuleKey[];
  /**
   * Pro `child`: všechny uvedené klíče musí být true (typicky jeden rodič).
   */
  parentLicenseKeys?: readonly CanonicalModuleKey[];
  /** Pro `canAccessCompanyModule` + specifické kontroly sklad/výroba. */
  platformModuleCode: PlatformModuleCode | null;
};

/** A) Systémové sekce (nejsou „licencovaným modulem“ v sidebaru). */
export const SYSTEM_MENU_ITEM_IDS = [
  "overview",
  "chat",
  "settings",
] as const;

/** B) Licencované moduly v menu — mapování id → kanonický klíč (bez terminal). */
export const MODULE_MENU_MAP: Record<
  string,
  { licenseKeys: readonly CanonicalModuleKey[]; platformModuleCode: PlatformModuleCode | null }
> = {
  employees: { licenseKeys: ["dochazka"], platformModuleCode: "attendance_payroll" },
  labor: { licenseKeys: ["dochazka"], platformModuleCode: "attendance_payroll" },
  jobs: { licenseKeys: ["zakazky"], platformModuleCode: "jobs" },
  finance: { licenseKeys: ["finance"], platformModuleCode: "invoicing" },
  invoices: { licenseKeys: ["faktury"], platformModuleCode: "invoicing" },
  documents: { licenseKeys: ["doklady"], platformModuleCode: "invoicing" },
  sklad: { licenseKeys: ["sklad"], platformModuleCode: "sklad" },
  vyroba: { licenseKeys: ["vyroba"], platformModuleCode: "vyroba" },
  reports: { licenseKeys: ["reporty"], platformModuleCode: "attendance_payroll" },
  billing: { licenseKeys: ["predplatne"], platformModuleCode: null },
};

/** C) Děti — zobrazí se jen pokud je aktivní rodičovský modul v licenci. */
export const MODULE_CHILDREN_MAP: Record<string, CanonicalModuleKey> = {
  customers: "zakazky",
  leads: "zakazky",
  activity: "reporty",
};

/** Pořadí a metadata položek firemního portálu (shora dolů). */
export const PORTAL_SIDEBAR_MENU_DEFS: readonly PortalSidebarMenuDef[] = [
  {
    id: "overview",
    type: "system",
    label: "Přehled",
    href: "/portal/dashboard",
    roles: ["owner", "admin", "manager", "accountant", "employee", "customer"],
    platformModuleCode: null,
  },
  {
    id: "employees",
    type: "module",
    label: "Zaměstnanci",
    href: "/portal/employees",
    roles: ["owner", "admin", "manager"],
    licenseKeys: ["dochazka"],
    platformModuleCode: "attendance_payroll",
  },
  {
    id: "labor",
    type: "module",
    label: "Práce a mzdy",
    href: "/portal/labor/dochazka",
    roles: ["owner", "admin", "manager", "accountant", "employee"],
    licenseKeys: ["dochazka"],
    platformModuleCode: "attendance_payroll",
  },
  {
    id: "customers",
    type: "child",
    label: "Zákazníci",
    href: "/portal/customers",
    roles: ["owner", "admin", "manager", "accountant"],
    parentLicenseKeys: ["zakazky"],
    platformModuleCode: "jobs",
  },
  {
    id: "jobs",
    type: "module",
    label: "Zakázky",
    href: "/portal/jobs",
    roles: ["owner", "admin", "manager", "employee", "customer"],
    licenseKeys: ["zakazky"],
    platformModuleCode: "jobs",
  },
  {
    id: "leads",
    type: "child",
    label: "Poptávky",
    href: "/portal/leads",
    roles: ["owner", "admin", "manager", "accountant", "employee"],
    parentLicenseKeys: ["zakazky"],
    platformModuleCode: "jobs",
  },
  {
    id: "finance",
    type: "module",
    label: "Finance",
    href: "/portal/finance",
    roles: ["owner", "admin", "accountant"],
    licenseKeys: ["finance"],
    platformModuleCode: "invoicing",
  },
  {
    id: "invoices",
    type: "module",
    label: "Faktury",
    href: "/portal/invoices",
    roles: ["owner", "admin", "accountant"],
    licenseKeys: ["faktury"],
    platformModuleCode: "invoicing",
  },
  {
    id: "documents",
    type: "module",
    label: "Doklady",
    href: "/portal/documents",
    roles: ["owner", "admin", "accountant", "customer"],
    licenseKeys: ["doklady"],
    platformModuleCode: "invoicing",
  },
  {
    id: "sklad",
    type: "module",
    label: MODULE_DEFINITIONS.sklad.menuLabel,
    href: "/portal/sklad",
    roles: ["owner", "admin", "manager", "accountant", "employee"],
    licenseKeys: ["sklad"],
    platformModuleCode: "sklad",
  },
  {
    id: "vyroba",
    type: "module",
    label: MODULE_DEFINITIONS.vyroba.menuLabel,
    href: "/portal/vyroba",
    roles: ["owner", "admin", "manager", "accountant", "employee"],
    licenseKeys: ["vyroba"],
    platformModuleCode: "vyroba",
  },
  {
    id: "reports",
    type: "module",
    label: "Reporty",
    href: "/portal/reports",
    roles: ["owner", "admin", "manager", "accountant"],
    licenseKeys: ["reporty"],
    platformModuleCode: "attendance_payroll",
  },
  {
    id: "activity",
    type: "child",
    label: "Aktivita",
    href: "/portal/report",
    roles: ["owner", "admin"],
    parentLicenseKeys: ["reporty"],
    platformModuleCode: null,
  },
  {
    id: "billing",
    type: "module",
    label: MODULE_DEFINITIONS.predplatne.menuLabel,
    href: "/portal/billing",
    roles: ["owner"],
    licenseKeys: ["predplatne"],
    platformModuleCode: null,
  },
  {
    id: "chat",
    type: "system",
    label: "Zprávy",
    href: "/portal/chat",
    roles: ["owner", "admin", "manager", "accountant", "employee"],
    platformModuleCode: null,
  },
  {
    id: "settings",
    type: "system",
    label: "Nastavení",
    href: "/portal/settings",
    roles: ["owner", "admin", "manager", "accountant", "employee"],
    platformModuleCode: null,
  },
];

export function licenseKeysSatisfied(
  keys: readonly CanonicalModuleKey[] | undefined,
  effectiveModules: Record<string, boolean | null | undefined>
): boolean {
  if (!keys?.length) return true;
  return keys.some((k) => Boolean(effectiveModules[k]));
}

export function parentLicenseKeysSatisfied(
  keys: readonly CanonicalModuleKey[] | undefined,
  effectiveModules: Record<string, boolean | null | undefined>
): boolean {
  if (!keys?.length) return true;
  return keys.every((k) => Boolean(effectiveModules[k]));
}
