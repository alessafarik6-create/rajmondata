/**
 * Creates the default superadmin account in Firestore (collection "superadmins").
 * Run from project root: node scripts/seed-superadmin.js
 * Requires: .env.local with FIREBASE_PROJECT_ID (or NEXT_PUBLIC_FIREBASE_PROJECT_ID),
 *           FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *
 * Default credentials: username "admin", password "admin123"
 * Password is stored as bcrypt hash only.
 */
const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });

const bcrypt = require("bcryptjs");
const admin = require("firebase-admin");

const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin123";
const SALT_ROUNDS = 10;

function getFirestore() {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      "Missing Firebase Admin env. Set in .env.local: NEXT_PUBLIC_FIREBASE_PROJECT_ID (or FIREBASE_PROJECT_ID), FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
    );
    process.exit(1);
  }

  if (!admin.apps?.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }
  return admin.firestore();
}

async function main() {
  const db = getFirestore();
  const col = db.collection("superadmins");
  const trimmedUsername = DEFAULT_USERNAME.trim().toLowerCase();

  const existing = await col.where("username", "==", trimmedUsername).limit(1).get();
  if (!existing.empty) {
    console.log(
      "Default superadmin already exists (username: %s). No change made.",
      trimmedUsername
    );
    console.log(
      "To change the password, update the document's passwordHash in Firestore (Firebase Console → Firestore → superadmins)."
    );
    process.exit(0);
    return;
  }

  const passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, SALT_ROUNDS);
  await col.add({
    username: trimmedUsername,
    passwordHash,
    role: "superadmin",
    active: true,
    createdAt: new Date(),
  });

  console.log("Default superadmin account created.");
  console.log("  Username: %s", trimmedUsername);
  console.log("  Password: (use '%s' to log in)", DEFAULT_PASSWORD);
  console.log("");
  console.log("Optional: to use env-based login instead of Firestore, add to .env.local:");
  console.log("  SUPERADMIN_USERNAME=admin");
  console.log("  SUPERADMIN_PASSWORD_HASH=%s", passwordHash);
  console.log("");
  console.log("Credentials are stored in Firestore:");
  console.log("  Collection: superadmins");
  console.log("  Fields: username, passwordHash, role, active, createdAt");
  console.log("");
  console.log("To change the password later:");
  console.log("  1. Firebase Console → Firestore → superadmins → document for 'admin'");
  console.log("  2. Replace passwordHash with a new bcrypt hash, e.g. run:");
  console.log("     node -e \"console.log(require('bcryptjs').hashSync('YourNewPassword', 10))\"");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
