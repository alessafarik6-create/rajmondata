import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";

export function getRajmondataEditorEnv() {
  const appUrl =
    process.env.RAJMONDATA_EDITOR_APP_URL?.trim() ||
    "https://rajmondata-editor-production.up.railway.app";
  const apiUrl =
    process.env.RAJMONDATA_EDITOR_API_URL?.trim() ||
    process.env.RAJMONDATA_EDITOR_APP_URL?.trim() ||
    "https://rajmondata-editor-production.up.railway.app";
  const secret = process.env.RAJMONDATA_EDITOR_INTEGRATION_SECRET?.trim() || "";
  const launchPath =
    process.env.RAJMONDATA_EDITOR_LAUNCH_TICKETS_PATH?.trim() ||
    "/api/integrations/rajmondata-portal/v1/launch-tickets";
  const revokePath =
    process.env.RAJMONDATA_EDITOR_REVOKE_PATH?.trim() ||
    "/api/integrations/rajmondata-portal/v1/revoke-access";
  return { appUrl, apiUrl, secret, launchPath, revokePath };
}

export function editorUrlsFromCatalog(row: PlatformModuleCatalogRow) {
  const env = getRajmondataEditorEnv();
  return {
    appUrl: row.appUrl?.trim() || env.appUrl,
    apiUrl: row.apiUrl?.trim() || env.apiUrl,
  };
}
