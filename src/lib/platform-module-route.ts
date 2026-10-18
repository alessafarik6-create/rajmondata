import { DEFAULT_PLATFORM_MODULES, PLATFORM_MODULE_CODES, type PlatformModuleCode } from "@/lib/platform-config";

const ROUTE_ALIASES: Record<string, PlatformModuleCode> = {
  "rajmondata-editor": "rajmondata_editor",
};

/** Mapuje slug z URL (včetně externalId) na kód modulu v licenci. */
export function resolvePlatformModuleFromRouteParam(raw: string): PlatformModuleCode | null {
  const decoded = decodeURIComponent(String(raw ?? "").trim());
  if (!decoded) return null;
  if ((PLATFORM_MODULE_CODES as readonly string[]).includes(decoded)) {
    return decoded as PlatformModuleCode;
  }
  const alias = ROUTE_ALIASES[decoded];
  if (alias) return alias;
  for (const def of DEFAULT_PLATFORM_MODULES) {
    if (def.externalId && def.externalId === decoded) return def.code;
  }
  return null;
}

export function normalizePlatformModuleRouteParam(raw: string): PlatformModuleCode | null {
  return resolvePlatformModuleFromRouteParam(raw);
}
