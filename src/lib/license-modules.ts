/**
 * Centrální definice modulů: kanonické klíče (Firestore + interní API), labely pro admin/menu, aliasy.
 * Čtení vždy přes normalizeModules / normalizeModuleKey — žádné porovnávání podle labelu.
 */

export const CANONICAL_MODULE_KEYS = [
  "zakazky",
  "dochazka",
  "finance",
  "faktury",
  "doklady",
  "terminal",
  "sklad",
  "vyroba",
  "reporty",
  "predplatne",
] as const;

export type CanonicalModuleKey = (typeof CANONICAL_MODULE_KEYS)[number];

export const MODULE_DEFINITIONS: {
  [K in CanonicalModuleKey]: {
    label: string;
    menuLabel: string;
    aliases: readonly string[];
    /**
     * false = klíč zůstává v licenci pro přístup (např. veřejný terminál), ale nesmí generovat
     * samostatnou položku v levém menu portálu — viz `portal-menu-config.ts`.
     */
    exposesSidebarItem?: boolean;
  };
} = {
  zakazky: {
    label: "Zakázky / Projekty",
    menuLabel: "Zakázky",
    aliases: ["projects", "project", "jobs", "job"],
  },
  dochazka: {
    label: "Docházka",
    menuLabel: "Docházka",
    aliases: ["attendance", "worklog"],
  },
  finance: {
    label: "Finance",
    menuLabel: "Finance",
    aliases: ["financial"],
  },
  faktury: {
    label: "Faktury",
    menuLabel: "Faktury",
    aliases: ["invoices", "invoicing"],
  },
  doklady: {
    label: "Doklady",
    menuLabel: "Doklady",
    aliases: ["documents"],
  },
  terminal: {
    label: "Mobilní terminál (terminál docházky)",
    menuLabel: "Terminál",
    exposesSidebarItem: false,
    aliases: [
      "mobileTerminal",
      "mobile_terminal",
      "attendanceTerminal",
      "attendance_terminal",
    ],
  },
  sklad: {
    label: "Sklad",
    menuLabel: "Sklad",
    aliases: ["warehouse"],
  },
  vyroba: {
    label: "Výroba",
    menuLabel: "Výroba",
    aliases: ["production"],
  },
  reporty: {
    label: "Reporty",
    menuLabel: "Reporty",
    aliases: ["reports"],
  },
  predplatne: {
    label: "Předplatné / Fakturace",
    menuLabel: "Předplatné",
    aliases: ["billing", "subscriptions"],
  },
};

/** Alias / legacy klíč → kanonický (case-insensitive pro ASCII klíče). */
const KEY_LOOKUP = (() => {
  const m = new Map<string, CanonicalModuleKey>();
  const add = (raw: string, canon: CanonicalModuleKey) => {
    m.set(raw, canon);
    m.set(raw.toLowerCase(), canon);
  };
  for (const canon of CANONICAL_MODULE_KEYS) {
    add(canon, canon);
    for (const a of MODULE_DEFINITIONS[canon].aliases) {
      add(a, canon);
    }
  }
  return m;
})();

export function normalizeModuleKey(raw: string): CanonicalModuleKey | null {
  const t = raw.trim();
  if (!t) return null;
  return KEY_LOOKUP.get(t) ?? KEY_LOOKUP.get(t.toLowerCase()) ?? null;
}

function emptyCanonicalMap(): Record<CanonicalModuleKey, boolean> {
  const out = {} as Record<CanonicalModuleKey, boolean>;
  for (const k of CANONICAL_MODULE_KEYS) {
    out[k] = false;
  }
  return out;
}

/**
 * Převod libovolné mapy modulů (legacy / aliasy / smíšené klíče) na výhradně kanonické klíče.
 * Destruktivní migrace v DB se neprovádí — jen runtime při čtení.
 */
export function normalizeModules(
  raw: Record<string, boolean | undefined> | null | undefined
): Record<CanonicalModuleKey, boolean> {
  const out = emptyCanonicalMap();
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "boolean") continue;
    const canon = normalizeModuleKey(k);
    if (!canon) continue;
    out[canon] = Boolean(out[canon]) || v;
  }
  return out;
}

/** Pole ID z API / Firestore → unikátní kanonické klíče. */
export function normalizeEnabledModuleIds(raw: readonly string[]): CanonicalModuleKey[] {
  const seen = new Set<CanonicalModuleKey>();
  const out: CanonicalModuleKey[] = [];
  for (const x of raw) {
    const c = normalizeModuleKey(String(x));
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Superadmin / Firestore: rozliší explicitní zápis v mapách vs. pole `enabledModules`.
 * Pořadí: top-level `organization.modules` přepíše `license.modules`; chybějící klíč po explicitních mapách = vypnuto.
 * Pole se použije jen když v dokumentu není žádný explicitní boolean u žádného kanonického klíče v těchto mapách.
 */
export function resolveCanonicalModuleMapForAdmin(row: {
  license?: {
    enabledModules?: string[];
    modules?: Record<string, boolean | undefined>;
  } | null;
  enabledModuleIds?: string[] | null;
  modules?: Record<string, boolean | undefined> | null;
}): Record<CanonicalModuleKey, boolean> {
  const out = emptyCanonicalMap();
  const lic = row.license;
  const licModules = lic?.modules && typeof lic.modules === "object" ? lic.modules : undefined;
  const topModules = row.modules && typeof row.modules === "object" ? row.modules : undefined;

  const anyExplicitMap = MODULE_KEYS.some(
    (k) =>
      (topModules && Object.prototype.hasOwnProperty.call(topModules, k)) ||
      (licModules && Object.prototype.hasOwnProperty.call(licModules, k))
  );

  const arrKeys = new Set<CanonicalModuleKey>(
    Array.isArray(lic?.enabledModules)
      ? normalizeEnabledModuleIds(lic.enabledModules.map((x) => String(x)))
      : Array.isArray(row.enabledModuleIds)
        ? normalizeEnabledModuleIds(row.enabledModuleIds.map((x) => String(x)))
        : []
  );

  for (const k of MODULE_KEYS) {
    if (topModules && Object.prototype.hasOwnProperty.call(topModules, k)) {
      out[k] = Boolean(topModules[k]);
    } else if (licModules && Object.prototype.hasOwnProperty.call(licModules, k)) {
      out[k] = Boolean(licModules[k]);
    } else if (!anyExplicitMap) {
      out[k] = arrKeys.has(k);
    }
  }
  return out;
}

/** Firestore `modules` / `license.modules` — pouze kanonické klíče, všechny výskyty uvedené. */
export function buildCanonicalModulesMapFromEnabled(
  enabled: readonly CanonicalModuleKey[]
): Record<CanonicalModuleKey, boolean> {
  const out = emptyCanonicalMap();
  for (const k of enabled) {
    if (CANONICAL_MODULE_KEYS.includes(k)) out[k] = true;
  }
  return out;
}

/** @deprecated Stejné jako buildCanonicalModulesMapFromEnabled — ponecháno kvůli importům. */
export const buildMergedFirestoreModulesMap = buildCanonicalModulesMapFromEnabled;

/** Sloučení více zdrojů — OR hodnot. */
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

export function mergeLicenseAndOrganizationModuleLayers(
  licenseModules: Record<string, boolean | undefined> | null | undefined,
  organizationModules: Record<string, boolean | undefined> | null | undefined
): Record<CanonicalModuleKey, boolean> {
  const lic =
    licenseModules && typeof licenseModules === "object" ? licenseModules : {};
  const org =
    organizationModules && typeof organizationModules === "object"
      ? organizationModules
      : {};
  return normalizeModules({ ...lic, ...org });
}

/** @deprecated Použij normalizeModules. */
export function expandModuleRecordAliases(
  raw: Record<string, boolean | undefined>
): Record<string, boolean> {
  return normalizeModules(raw);
}

export function isModuleKeyEnabled(
  effectiveModules: Record<string, boolean | null | undefined> | null | undefined,
  key: string
): boolean {
  const c = normalizeModuleKey(key);
  if (!c) return false;
  return Boolean(effectiveModules?.[c]);
}

/** Interní klíč modulu = kanonický klíč (kompatibilita se starým názvem typu). */
export type ModuleKey = CanonicalModuleKey;

export const MODULE_KEYS: ModuleKey[] = [...CANONICAL_MODULE_KEYS];

/** Synonymum pro menu / merge — jen kanonické klíče. */
export const ORG_MENU_MODULE_KEYS = CANONICAL_MODULE_KEYS;

export type OrgMenuModuleKey = CanonicalModuleKey;

/** UI superadminu: `key` je vždy kanonický, `label` lidský text. */
export const AVAILABLE_MODULES = CANONICAL_MODULE_KEYS.map((key) => ({
  key,
  label: MODULE_DEFINITIONS[key].label,
  /** Volitelná nápověda v dialogu licence (Firestore se nemění). */
  adminHint:
    key === "terminal"
      ? "Není samostatná položka v levém menu portálu — řídí přístup k veřejnému terminálu docházky (/attendance-login), spolu s modulem Docházka."
      : undefined,
}));

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
  enabledModules: ["zakazky", "dochazka", "faktury", "doklady"],
};
