"use client";

import type { User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { USERS_COLLECTION } from "@/lib/firestore-collections";
import { ensureUserProfile } from "@/lib/seed-firestore";

/**
 * Zajistí existenci dokumentu `users/{uid}` po přihlášení / obnově relace.
 * Pokud chybí, zavolá `ensureUserProfile` (firma + vlastník).
 * Idempotentní — bezpečné opakované volání.
 */
export async function ensureUserFirestoreDocument(
  user: User,
  firestore: Firestore
): Promise<void> {
  const userRef = doc(firestore, USERS_COLLECTION, user.uid);

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (e) {
    console.error("[ensureUserFirestoreDocument] getDoc failed", e);
    throw e;
  }

  if (snap.exists()) {
    const d = snap.data() as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (user.email && d.email !== user.email) {
      patch.email = user.email;
    }
    if (d.uid == null || d.uid === "") {
      patch.uid = user.uid;
    }
    if (d.id == null || d.id === "") {
      patch.id = user.uid;
    }
    const display = (user.displayName || "").trim();
    const fallbackName =
      display || (user.email || "").split("@")[0] || "Uživatel";
    if (d.name == null || d.name === "") {
      patch.name = fallbackName;
    }
    if (d.displayName == null || d.displayName === "") {
      patch.displayName = display || fallbackName;
    }

    if (Object.keys(patch).length > 0) {
      patch.updatedAt = serverTimestamp();
      await setDoc(userRef, patch, { merge: true });
    }
    return;
  }

  console.log("Creating missing user profile", { uid: user.uid, email: user.email });
  await ensureUserProfile(user, firestore);
}
