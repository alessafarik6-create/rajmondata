import { logFirebasePublicEnvIfIncomplete } from "@/lib/firebase-client-env";

/**
 * Runs once when the Node.js server starts (dev and prod).
 * Logs missing NEXT_PUBLIC_FIREBASE_* names only — never values.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    logFirebasePublicEnvIfIncomplete();
  }
}
