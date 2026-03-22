import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let adminFirestore: Firestore | null = null;
let adminAuth: Auth | null = null;

const LOG_PREFIX = "[firebase-admin]";

export function getAdminFirestore(): Firestore | null {
  if (adminFirestore) return adminFirestore;

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
  const privateKey = rawPrivateKey?.replace(/\\n/g, "\n");

  // Safe logging: presence only (no secrets)
  console.log(`${LOG_PREFIX} FIREBASE_PROJECT_ID: ${projectId ? "present" : "missing"}`);
  console.log(`${LOG_PREFIX} FIREBASE_CLIENT_EMAIL: ${clientEmail ? "present" : "missing"}`);
  console.log(`${LOG_PREFIX} FIREBASE_PRIVATE_KEY: ${rawPrivateKey ? `present (length ${rawPrivateKey.length})` : "missing"}`);

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(`${LOG_PREFIX} Skipping init: one or more required env vars missing.`);
    return null;
  }

  try {
    const admin = require("firebase-admin") as typeof import("firebase-admin");
    if (!admin.apps?.length) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      console.log(`${LOG_PREFIX} initializeApp succeeded (single default app).`);
    }
    const app = admin.app();
    const rawDbId =
      process.env.FIRESTORE_DATABASE_ID?.trim() ||
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID?.trim() ||
      "";
    const useNamedDb = rawDbId.length > 0 && rawDbId !== "(default)";
    adminFirestore = useNamedDb ? getFirestore(app, rawDbId) : getFirestore(app);
    console.log(
      `${LOG_PREFIX} Firestore database:`,
      useNamedDb ? rawDbId : "(default)"
    );
    const appPid = admin.apps?.length ? app.options.projectId : undefined;
    console.log(`${LOG_PREFIX} App options projectId:`, appPid ?? "(unknown)");
    return adminFirestore;
  } catch (e) {
    const err = e as Error;
    console.error(`${LOG_PREFIX} init error:`, err?.message ?? String(e));
    return null;
  }
}

/** Firebase Auth (Admin) — např. vytvoření účtu zaměstnance. */
export function getAdminAuth(): Auth | null {
  if (adminAuth) return adminAuth;
  if (!getAdminFirestore()) return null;
  try {
    const admin = require("firebase-admin") as typeof import("firebase-admin");
    adminAuth = admin.auth();
    return adminAuth;
  } catch (e) {
    console.error(`${LOG_PREFIX} getAdminAuth:`, (e as Error)?.message ?? e);
    return null;
  }
}

/** Pro diagnostiku (env vs Admin app) — žádné tajné klíče. */
export function getFirebaseAdminDebugSummary(): {
  envFirebaseProjectId: string | null;
  envNextPublicFirebaseProjectId: string | null;
  adminAppProjectId: string | null;
  appsCount: number;
  firestoreDatabaseId: string;
} {
  const rawDbId =
    process.env.FIRESTORE_DATABASE_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID?.trim() ||
    "";
  const firestoreDatabaseId =
    rawDbId.length > 0 && rawDbId !== "(default)" ? rawDbId : "(default)";
  try {
    const admin = require("firebase-admin") as typeof import("firebase-admin");
    const appsCount = admin.apps?.length ?? 0;
    const adminAppProjectId =
      appsCount > 0 ? (admin.app().options.projectId as string | undefined) ?? null : null;
    return {
      envFirebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() ?? null,
      envNextPublicFirebaseProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? null,
      adminAppProjectId,
      appsCount,
      firestoreDatabaseId,
    };
  } catch {
    return {
      envFirebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() ?? null,
      envNextPublicFirebaseProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? null,
      adminAppProjectId: null,
      appsCount: 0,
      firestoreDatabaseId,
    };
  }
}
