import type { FirebaseOptions } from "firebase/app";

/** Public Web SDK keys — must be set in .env.local (local) or Vercel env (prod). */
export const REQUIRED_NEXT_PUBLIC_FIREBASE_KEYS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

export type FirebasePublicEnvResult = {
  ok: boolean;
  missing: string[];
  config: FirebaseOptions;
};

/**
 * Reads NEXT_PUBLIC_FIREBASE_* from the environment.
 * Do not log values — API keys are still sensitive in client bundles.
 *
 * Important: Next.js only inlines `process.env.NEXT_PUBLIC_*` when each name is
 * referenced statically. Dynamic access like `process.env[key]` is not replaced
 * in the client bundle and will be undefined in production (e.g. Vercel).
 */
export function getFirebasePublicEnv(): FirebasePublicEnvResult {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  const missing: string[] = [];
  if (!String(apiKey ?? "").trim()) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!String(authDomain ?? "").trim()) missing.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!String(projectId ?? "").trim()) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (!String(storageBucket ?? "").trim()) missing.push("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  if (!String(messagingSenderId ?? "").trim()) {
    missing.push("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
  }
  if (!String(appId ?? "").trim()) missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");

  const config: FirebaseOptions = {
    apiKey: apiKey ?? "",
    authDomain: authDomain ?? "",
    projectId: projectId ?? "",
    storageBucket: storageBucket ?? "",
    messagingSenderId: messagingSenderId ?? "",
    appId: appId ?? "",
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || undefined,
  };

  return { ok: missing.length === 0, missing, config };
}

/** Call from instrumentation or server startup — logs only missing key names. */
export function logFirebasePublicEnvIfIncomplete(): void {
  const { ok, missing } = getFirebasePublicEnv();
  if (ok) {
    console.log(
      "[firebase] Client Web SDK: required NEXT_PUBLIC_FIREBASE_* variables are set."
    );
    return;
  }
  console.error(
    "[firebase] Client Web SDK: missing required environment variables:\n  - " +
      missing.join("\n  - ") +
      "\nCreate .env.local from .env.example and paste values from Firebase Console → Project settings → Your apps."
  );
}

/** User-visible message when env is incomplete (safe to show in UI). */
export function getFirebaseClientEnvUserMessage(): string | null {
  const { ok, missing } = getFirebasePublicEnv();
  if (ok) return null;
  return `Chybí konfigurace Firebase (${missing.length} proměnných). Zkopírujte .env.example do .env.local a doplňte hodnoty z Firebase Console.`;
}

/**
 * When true, connect Auth/Firestore to local emulators (must run `firebase emulators:start`).
 */
export function shouldConnectFirebaseEmulators(): boolean {
  const v = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS;
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Maps Firebase Auth errors to Czech copy; improves opaque network failures.
 */
export function describeFirebaseAuthError(code: string | undefined): string {
  switch (code) {
    case "auth/invalid-email":
      return "Email nemá správný formát.";
    case "auth/user-disabled":
      return "Tento účet je zakázán.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Neplatný email nebo heslo.";
    case "auth/too-many-requests":
      return "Příliš mnoho pokusů. Zkuste to znovu za chvíli.";
    case "auth/network-request-failed":
      return (
        "Nepodařilo se spojit s Firebase Auth. Zkontrolujte připojení k internetu. " +
        "Při lokálním vývoji ověřte, že máte v .env.local vyplněné NEXT_PUBLIC_FIREBASE_* z Firebase Console " +
        "a že nemáte NEXT_PUBLIC_USE_FIREBASE_EMULATORS, pokud neběží příkaz firebase emulators:start."
      );
    case "auth/missing-email":
      return "Zadejte emailovou adresu.";
    default:
      return "Neplatný email nebo heslo.";
  }
}
