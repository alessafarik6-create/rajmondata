/**
 * Global list of modules that can be enabled/disabled per organization license.
 * Superadmin toggles these per organization.
 */
export const AVAILABLE_MODULES = [
  { key: "jobs", label: "Zakázky / Projekty" },
  { key: "attendance", label: "Docházka" },
  { key: "invoices", label: "Faktury" },
  { key: "finance", label: "Finance" },
  { key: "documents", label: "Doklady" },
  { key: "reports", label: "Reporty" },
  { key: "mobile_terminal", label: "Mobilní terminál" },
  { key: "subscriptions", label: "Předplatné / Fakturace" },
  { key: "sklad", label: "Sklad" },
  { key: "vyroba", label: "Výroba" },
] as const;

export type ModuleKey = (typeof AVAILABLE_MODULES)[number]["key"];

/** All valid module keys for validation and filtering */
export const MODULE_KEYS: ModuleKey[] = [
  "jobs",
  "attendance",
  "invoices",
  "finance",
  "documents",
  "reports",
  "mobile_terminal",
  "subscriptions",
  "sklad",
  "vyroba",
];

/** Top-level `companies/{id}.modules` / `společnosti/{id}.modules` — stejné klíče jako v superadmin checkboxech. */
export function buildTopLevelModuleMapFromKeys(
  enabled: readonly ModuleKey[]
): Record<ModuleKey, boolean> {
  const set = new Set(enabled);
  const out = {} as Record<ModuleKey, boolean>;
  for (const k of MODULE_KEYS) {
    out[k] = set.has(k);
  }
  return out;
}

export const LICENSE_TYPES = [
  { value: "starter", label: "Starter" },
  { value: "professional", label: "Professional" },
  { value: "enterprise", label: "Enterprise" },
] as const;

export type LicenseType = (typeof LICENSE_TYPES)[number]["value"];

export const LICENSE_STATUSES = [
  { value: "active", label: "Aktivní" },
  { value: "pending", label: "Čeká na schválení" },
  { value: "inactive", label: "Neaktivní" },
  { value: "expired", label: "Expirovaná" },
  { value: "suspended", label: "Pozastavená" },
] as const;

export type LicenseStatus = (typeof LICENSE_STATUSES)[number]["value"];

export interface LicenseConfig {
  licenseType: LicenseType;
  status: LicenseStatus;
  expirationDate: string | null;
  maxUsers: number | null;
  enabledModules: ModuleKey[];
}

export const DEFAULT_LICENSE: LicenseConfig = {
  licenseType: "starter",
  status: "active",
  expirationDate: null,
  maxUsers: 10,
  enabledModules: ["jobs", "attendance", "invoices", "documents"],
};
