"use client";

import type { User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { USERS_COLLECTION } from "@/lib/firestore-collections";
import { ensureUserProfile } from "@/lib/seed-firestore";

/**
 * Doplní metadata v `users/{uid}` (email, displayName) po přihlášení.
 * Nevytváří nový Firestore profil ani firmu — to jen registrace (`allowCreate`) nebo manuální seed.
 */
export async function ensureUserFirestoreDocument(
  user: User,
  firestore: Firestore,
  options?: { allowCreate?: boolean }
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

  if (options?.allowCreate !== true) {
    console.warn(
      "[ensureUserFirestoreDocument] Dokument users/{uid} neexistuje — auto-create zakázán (portál nepřidává profil)."
    );
    return;
  }

  console.log("Creating missing user profile", { uid: user.uid, email: user.email });
  await ensureUserProfile(user, firestore);
}
