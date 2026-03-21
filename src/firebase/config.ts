/**
 * Firebase Web SDK config from NEXT_PUBLIC_FIREBASE_* (see .env.example).
 * No baked-in project secrets — add .env.local for local dev and Vercel env for production.
 */
import { getFirebasePublicEnv } from "@/lib/firebase-client-env";

const env = getFirebasePublicEnv();

export const firebaseConfig = env.config;

export const firebaseClientEnvReady = env.ok;

export const firebaseClientEnvMissingKeys = env.missing;
