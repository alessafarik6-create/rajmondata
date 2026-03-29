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

/**
 * České / doménové klíče na dokumentu organizace (`modules`) — menu portálu je z nich čte (s fallbackem na license).
 */
export const ORG_MENU_MODULE_KEYS = [
  "zakazky",
  "dochazka",
  "finance",
  "sklad",
  "vyroba",
  "faktury",
  "doklady",
  "terminal",
  "reporty",
  "predplatne",
] as const;

export type OrgMenuModuleKey = (typeof ORG_MENU_MODULE_KEYS)[number];

export function buildOrgMenuModuleMapFromEnabledKeys(
  enabled: readonly ModuleKey[]
): Record<OrgMenuModuleKey, boolean> {
  const set = new Set(enabled);
  return {
    zakazky: set.has("jobs"),
    dochazka: set.has("attendance"),
    faktury: set.has("invoices"),
    finance: set.has("finance"),
    doklady: set.has("documents"),
    terminal: set.has("mobile_terminal"),
    sklad: set.has("sklad"),
    vyroba: set.has("vyroba"),
    reporty: set.has("reports"),
    predplatne: set.has("subscriptions"),
  };
}

/**
 * Synonyma napříč dokumenty (projects / warehouse / billing …) → kanonické klíče v jedné mapě.
 */
const MODULE_KEY_ALIASES: Record<string, readonly string[]> = {
  projects: ["jobs", "zakazky"],
  zakazky: ["jobs", "zakazky"],
  jobs: ["jobs", "zakazky"],
  warehouse: ["sklad"],
  sklad: ["sklad"],
  production: ["vyroba"],
  vyroba: ["vyroba"],
  attendance: ["attendance", "dochazka"],
  dochazka: ["attendance", "dochazka"],
  mobile_terminal: ["mobile_terminal", "terminal"],
  terminal: ["mobile_terminal", "terminal"],
  invoices: ["invoices", "faktury"],
  faktury: ["invoices", "faktury"],
  documents: ["documents", "doklady"],
  doklady: ["documents", "doklady"],
  finance: ["finance"],
  subscriptions: ["subscriptions", "predplatne"],
  predplatne: ["subscriptions", "predplatne"],
  reports: ["reports", "reporty"],
  reporty: ["reports", "reporty"],
  billing: ["faktury", "subscriptions", "predplatne", "invoices"],
};

/** Sloučení více zdrojů modulů — true vyhrává (OR). */
export function orMergeModuleRecords(
  ...parts: Array<Record<string, boolean | undefined> | null | undefined>
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    for (const [k, v] of Object.entries(p)) {
      if (typeof v !== "boolean") continue;
      out[k] = Boolean(out[k]) || v;
    }
  }
  return out;
}

/**
 * Podle aliasů doplní související klíče (např. `warehouse` → `sklad`).
 */
export function expandModuleRecordAliases(
  raw: Record<string, boolean | undefined>
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "boolean") continue;
    const expansion = MODULE_KEY_ALIASES[k];
    if (expansion) {
      for (const ck of expansion) {
        out[ck] = Boolean(out[ck]) || v;
      }
    } else {
      out[k] = Boolean(out[k]) || v;
    }
  }
  return out;
}

/** `...(license?.modules||{})` pak `...(organization?.modules||{})` — organizace přepíše stejné klíče; pak aliasy. */
export function mergeLicenseAndOrganizationModuleLayers(
  licenseModules: Record<string, boolean | undefined> | null | undefined,
  organizationModules: Record<string, boolean | undefined> | null | undefined
): Record<string, boolean> {
  const lic =
    licenseModules && typeof licenseModules === "object" ? licenseModules : {};
  const org =
    organizationModules && typeof organizationModules === "object"
      ? organizationModules
      : {};
  return expandModuleRecordAliases({
    ...lic,
    ...org,
  } as Record<string, boolean>);
}

export function isModuleKeyEnabled(
  effectiveModules: Record<string, boolean | null | undefined> | null | undefined,
  key: string
): boolean {
  return Boolean(effectiveModules?.[key]);
}

/** Zápis do Firestore: anglické klíče (superadmin checkboxy) + české klíče (menu organizace). */
export function buildMergedFirestoreModulesMap(
  enabled: readonly ModuleKey[]
): Record<string, boolean> {
  return {
    ...buildTopLevelModuleMapFromKeys(enabled),
    ...buildOrgMenuModuleMapFromEnabledKeys(enabled),
  };
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
