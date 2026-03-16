import type { Firestore } from "firebase-admin/firestore";

let adminFirestore: Firestore | null = null;

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
      console.log(`${LOG_PREFIX} initializeApp succeeded.`);
    }
    adminFirestore = admin.firestore();
    return adminFirestore;
  } catch (e) {
    const err = e as Error;
    console.error(`${LOG_PREFIX} init error:`, err?.message ?? String(e));
    return null;
  }
}
