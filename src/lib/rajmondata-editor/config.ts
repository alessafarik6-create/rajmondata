import "server-only";

import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import { getPortalApiSecret } from "@/lib/rajmondata-editor/portal-api-sign.server";

export function getRajmondataEditorEnv() {
  const origin =
    process.env.EDITOR_ORIGIN?.trim() ||
    process.env.RAJMONDATA_EDITOR_APP_URL?.trim() ||
    "https://rajmondata-editor-production.up.railway.app";
  const appUrl = origin;
  const apiUrl =
    process.env.RAJMONDATA_EDITOR_API_URL?.trim() ||
    process.env.EDITOR_ORIGIN?.trim() ||
    process.env.RAJMONDATA_EDITOR_APP_URL?.trim() ||
    origin;
  return { appUrl, apiUrl, secret: getPortalApiSecret() };
}

export function editorUrlsFromCatalog(row: PlatformModuleCatalogRow) {
  const env = getRajmondataEditorEnv();
  return {
    appUrl: row.appUrl?.trim() || env.appUrl,
    apiUrl: row.apiUrl?.trim() || env.apiUrl,
  };
}
