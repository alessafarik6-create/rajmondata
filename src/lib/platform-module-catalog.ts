/**
 * Sloučení globálního katalogu `platform_modules` s výchozími hodnotami z kódu.
 * Menu a licence firmy musí vycházet z org. dokumentu; při chybějícím explicitním
 * oprávnění se použije globální katalog (superadmin / Moduly).
 */

import type { CompanyLicenseDoc, PlatformModuleCode } from "@/lib/platform-config";
import { DEFAULT_PLATFORM_MODULES, PLATFORM_MODULE_CODES } from "@/lib/platform-config";
import { createPendingCompanyLicense } from "@/lib/company-license-record";

export type PlatformModuleCatalogRow = {
  activeGlobally: boolean;
  defaultEnabled: boolean;
};

/** Výchozí mapa z kódu — když Firestore ještě nic nemá nebo provider chybí. */
export function defaultPlatformCatalogMap(): Record<PlatformModuleCode, PlatformModuleCatalogRow> {
  const out = {} as Record<PlatformModuleCode, PlatformModuleCatalogRow>;
  for (const code of PLATFORM_MODULE_CODES) {
    const def = DEFAULT_PLATFORM_MODULES.find((m) => m.code === code);
    out[code] = {
      activeGlobally: Boolean(def?.activeGlobally),
      defaultEnabled: Boolean(def?.defaultEnabled),
    };
  }
  return out;
}

/** Sloučení dokumentů `platform_modules/{code}` s DEFAULT_PLATFORM_MODULES. */
export function buildMergedPlatformCatalogMap(
  firestoreDocs: Array<{ id: string } & Record<string, unknown>>
): Record<PlatformModuleCode, PlatformModuleCatalogRow> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const d of firestoreDocs) {
    byId.set(d.id, d);
  }
  const defaults = defaultPlatformCatalogMap();
  const out = {} as Record<PlatformModuleCode, PlatformModuleCatalogRow>;
  for (const code of PLATFORM_MODULE_CODES) {
    const doc = byId.get(code);
    out[code] = {
      activeGlobally:
        doc && typeof doc.activeGlobally === "boolean"
          ? doc.activeGlobally
          : defaults[code].activeGlobally,
      defaultEnabled:
        doc && typeof doc.defaultEnabled === "boolean"
          ? doc.defaultEnabled
          : defaults[code].defaultEnabled,
    };
  }
  return out;
}

/**
 * Počáteční licence při registraci firmy — explicitní `modules` podle globálního katalogu.
 * Varianta A: výchozí stav z globálního admina; superadmin u organizace může později přepsat.
 */
export function companyLicenseFromCatalogForNewOrg(
  companyId: string,
  catalog: Record<PlatformModuleCode, PlatformModuleCatalogRow>
): CompanyLicenseDoc {
  const base = createPendingCompanyLicense(companyId);
  const modules: CompanyLicenseDoc["modules"] = { ...base.modules };
  const enabledModules: PlatformModuleCode[] = [];
  for (const code of PLATFORM_MODULE_CODES) {
    const row = catalog[code];
    const active = Boolean(row.activeGlobally && row.defaultEnabled);
    modules[code] = {
      moduleCode: code,
      active,
      activatedAt: null,
      expiresAt: null,
      customPriceCzk: null,
    };
    if (active) enabledModules.push(code);
  }
  return { ...base, modules, enabledModules };
}
