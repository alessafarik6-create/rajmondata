import type { Auth } from "firebase-admin/auth";

/** Kanonická veřejná stránka pro nastavení hesla z e-mailového / admin odkazu. */
export const PASSWORD_RESET_PAGE_PATH = "/reset-password";

/** Zpráva při neplatném nebo expirovaném odkazu (shodně na stránce resetu). */
export const PASSWORD_RESET_INVALID_LINK_MESSAGE =
  "Odkaz pro reset hesla je neplatný nebo vypršel.";

const PRODUCTION_APP_FALLBACK = "https://rajmondata.cz";

export function resolveAppBaseUrl(): string {
  const fromEnv = String(
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ""
  )
    .trim()
    .replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return PRODUCTION_APP_FALLBACK;
  return "";
}

export function passwordResetContinueUrl(baseUrl?: string): string {
  const base = (baseUrl ?? resolveAppBaseUrl()).replace(/\/$/, "");
  return base ? `${base}/login` : "/login";
}

export function passwordResetActionCodeSettings(baseUrl?: string) {
  const url = passwordResetContinueUrl(baseUrl);
  return { url };
}

export type PasswordResetUrlParams = {
  mode: string;
  oobCode: string;
  apiKey: string | null;
  lang: string | null;
};

/** Extrahuje parametry resetu z Firebase __/auth/action nebo z URL aplikace. */
export function parsePasswordResetParamsFromLink(link: string): PasswordResetUrlParams | null {
  try {
    const u = new URL(link);
    const oobCode = u.searchParams.get("oobCode")?.trim() ?? "";
    const mode = u.searchParams.get("mode")?.trim() ?? "";
    if (!oobCode || (mode && mode !== "resetPassword")) return null;
    return {
      mode: mode || "resetPassword",
      oobCode,
      apiKey: u.searchParams.get("apiKey"),
      lang: u.searchParams.get("lang"),
    };
  } catch {
    return null;
  }
}

/**
 * Přepíše Firebase výchozí odkaz (__/auth/action na firebaseapp.com) na vlastní stránku portálu.
 * Odkaz, který už míří na aplikaci, normalizuje na kanonickou cestu.
 */
export function toAppPasswordResetUrl(
  firebaseOrAppLink: string,
  baseUrl?: string
): string {
  const base = (baseUrl ?? resolveAppBaseUrl()).replace(/\/$/, "");
  if (!base) return firebaseOrAppLink;

  const parsed = parsePasswordResetParamsFromLink(firebaseOrAppLink);
  if (!parsed) return firebaseOrAppLink;

  try {
    const u = new URL(firebaseOrAppLink);
    const host = u.hostname.toLowerCase();
    const alreadyApp =
      host === new URL(base).hostname.toLowerCase() &&
      (u.pathname === PASSWORD_RESET_PAGE_PATH ||
        u.pathname === "/login/obnova-hesla");
    const out = new URL(
      `${base}${alreadyApp ? u.pathname : PASSWORD_RESET_PAGE_PATH}`
    );
    out.searchParams.set("mode", "resetPassword");
    out.searchParams.set("oobCode", parsed.oobCode);
    if (parsed.apiKey) out.searchParams.set("apiKey", parsed.apiKey);
    if (parsed.lang) out.searchParams.set("lang", parsed.lang);
    return out.toString();
  } catch {
    return firebaseOrAppLink;
  }
}

/** Vygeneruje Firebase reset odkaz a přepíše ho na stránku portálu (rajmondata.cz/reset-password). */
export async function generateAppPasswordResetLink(
  auth: Auth,
  email: string,
  baseUrl?: string
): Promise<string> {
  const base = (baseUrl ?? resolveAppBaseUrl()).replace(/\/$/, "");
  if (!base) {
    throw new Error("APP_URL is not configured");
  }
  const firebaseLink = await auth.generatePasswordResetLink(
    email.trim().toLowerCase(),
    passwordResetActionCodeSettings(base)
  );
  return toAppPasswordResetUrl(firebaseLink, base);
}
