import type { Auth } from "firebase/auth";
import type { ActionCodeSettings } from "firebase/auth";
import { shouldConnectFirebaseEmulators } from "@/lib/firebase-client-env";

/**
 * Volitelná URL po dokončení resetu — nastavte jen pokud je doména v
 * Firebase → Authentication → Settings → Authorized domains.
 * Env: `NEXT_PUBLIC_FIREBASE_PASSWORD_RESET_CONTINUE_URL` (např. https://app.example.com/login).
 * Bez env se nepředává třetí argument → výchozí chování Firebase (méně rizika `unauthorized-continue-uri`).
 */
export function getPasswordResetActionCodeSettings():
  | ActionCodeSettings
  | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = process.env.NEXT_PUBLIC_FIREBASE_PASSWORD_RESET_CONTINUE_URL;
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return undefined;
  return { url: trimmed, handleCodeInApp: false };
}

/** Bezpečné logování kontextu (ne API key v plné délce). */
export function logPasswordResetAuthContext(
  phase: "pre-send" | "post-success" | "post-error",
  auth: Auth | null,
  normalizedEmail: string,
  extra?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  const app = auth?.app;
  const opts = app?.options;
  if (opts?.authDomain == null || String(opts.authDomain).trim() === "") {
    console.warn(
      "[passwordReset] firebaseAuthDomain is missing — reset e‑maily často selžou; doplňte NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN."
    );
  }

  console.log(`[passwordReset] ${phase}`, {
    email: normalizedEmail,
    authInstancePresent: Boolean(auth),
    firebaseProjectId: opts?.projectId ?? "(missing)",
    firebaseAuthDomain: opts?.authDomain ?? "(missing)",
    /** Prvních znaků apiKey jen pro ověření, že se nepletou env mezi projekty — nekopírujte do ticketů. */
    apiKeyPrefix:
      typeof opts?.apiKey === "string" && opts.apiKey.length > 0
        ? `${opts.apiKey.slice(0, 7)}…`
        : "(missing)",
    useAuthEmulator: shouldConnectFirebaseEmulators(),
    continueUrl: getPasswordResetActionCodeSettings()?.url ?? null,
    ...extra,
  });
}

export function describeSendPasswordResetError(code: string | undefined): {
  title: string;
  description: string;
} {
  switch (code) {
    case "auth/invalid-email":
      return {
        title: "Neplatný email",
        description: "Zadejte email ve správném formátu.",
      };
    case "auth/missing-email":
      return {
        title: "Chybí email",
        description: "Zadejte emailovou adresu.",
      };
    case "auth/user-not-found":
      return {
        title: "Reset se nepodařil",
        description:
          "Firebase hlásí, že účet s tímto e‑mailem neexistuje, nebo není povolený reset. Ověřte překlep; podrobnosti jsou v konzoli (F12).",
      };
    case "auth/too-many-requests":
      return {
        title: "Příliš mnoho pokusů",
        description: "Zkuste odeslání znovu za chvíli.",
      };
    case "auth/network-request-failed":
      return {
        title: "Síťová chyba",
        description:
          "Nepodařilo se spojit s Firebase Auth. Zkontrolujte připojení a blokátory.",
      };
    case "auth/operation-not-allowed":
      return {
        title: "Reset hesla není povolený",
        description:
          "V Firebase Console zapněte přihlášení e‑mailem a heslem (Authentication → Sign-in method → Email/Password).",
      };
    case "auth/invalid-api-key":
      return {
        title: "Neplatný klíč aplikace",
        description:
          "Zkontrolujte proměnnou NEXT_PUBLIC_FIREBASE_API_KEY (musí odpovídet stejnému projektu jako přihlášení).",
      };
    case "auth/app-not-authorized":
      return {
        title: "Aplikace není autorizovaná",
        description:
          "Tato doména nebo aplikace není v Firebase projektu povolená. Ověřte Authorized domains a konfiguraci webové aplikace.",
      };
    case "auth/unauthorized-continue-uri":
      return {
        title: "Neautorizovaná adresa po resetu",
        description:
          "URL po obnově hesla není v seznamu Authorized domains. Upravte NEXT_PUBLIC_FIREBASE_PASSWORD_RESET_CONTINUE_URL nebo přidejte doménu v konzoli Firebase.",
      };
    case "auth/missing-android-pkg-name":
    case "auth/missing-ios-bundle-id":
      return {
        title: "Chybná konfigurace aplikace",
        description: "Kontaktujte administrátora — chybí údaje mobilní aplikace v konzoli Firebase.",
      };
    default:
      return {
        title: "Obnova hesla selhala",
        description:
          "Požadavek se nepodařilo dokončit. Zkuste to znovu; podrobnosti jsou v konzoli prohlížeče (F12).",
      };
  }
}

export function logPasswordResetConsoleReminder(): void {
  console.info(
    "[passwordReset] Pokud email nedorazí přestože Firebase vrátil úspěch: " +
      "Firebase Console → Authentication → Sign-in method (Email/Password), " +
      "Templates (odesílání e‑mailů), Authorized domains, a u produkce SMTP / quota."
  );
}
