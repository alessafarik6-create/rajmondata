/** Veřejná konfigurace Hikvision EZUIKit JSSDK (bez API Secret). */

export const HIKVISION_JSSDK_DEFAULT_SCRIPT = "/hikvision-jssdk/ezuikit.js";
export const HIKVISION_JSSDK_DEFAULT_CSS = "/hikvision-jssdk/ezuikit.css";
export const HIKVISION_JSSDK_DEFAULT_STATIC = "/hikvision-jssdk/ezuikit_static";

export type HikvisionJssdkPublicConfig = {
  scriptUrl: string;
  cssUrl: string | null;
  staticPath: string;
  globalObject: "EZUIKit";
  playerConstructor: "EZUIKitPlayer";
};

export function getHikvisionJssdkPublicConfig(): HikvisionJssdkPublicConfig {
  const scriptUrl =
    String(process.env.NEXT_PUBLIC_HIKCONNECT_JSSDK_URL ?? "").trim() ||
    HIKVISION_JSSDK_DEFAULT_SCRIPT;
  const cssEnv = String(process.env.NEXT_PUBLIC_HIKCONNECT_JSSDK_CSS_URL ?? "").trim();
  /** v9 ezuikit-js nemá samostatný CSS bundle — volitelný stub v public pro alias ezUIKit.css. */
  const cssUrl =
    cssEnv ||
    (scriptUrl.startsWith("/") && !process.env.NEXT_PUBLIC_HIKCONNECT_JSSDK_URL
      ? HIKVISION_JSSDK_DEFAULT_CSS
      : null);
  const staticPath =
    String(process.env.NEXT_PUBLIC_HIKCONNECT_JSSDK_STATIC_PATH ?? "").trim() ||
    (scriptUrl.startsWith("/")
      ? HIKVISION_JSSDK_DEFAULT_STATIC
      : `${scriptUrl.replace(/\/[^/]*$/, "")}/ezuikit_static`);

  return {
    scriptUrl,
    cssUrl,
    staticPath,
    globalObject: "EZUIKit",
    playerConstructor: "EZUIKitPlayer",
  };
}
