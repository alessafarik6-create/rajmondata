import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { mergeNotificationPreferences } from "@/lib/notification-service/preferences";
import type { NotificationPreferenceGroups } from "@/lib/notification-service/types";

async function authUid(request: NextRequest): Promise<string | null> {
  const auth = getAdminAuth();
  if (!auth) return null;
  const idToken = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!idToken) return null;
  try {
    return (await auth.verifyIdToken(idToken)).uid;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const db = getAdminFirestore();
  const uid = await authUid(request);
  if (!db || !uid) {
    return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
  }
  const snap = await db.collection("users").doc(uid).get();
  const prefs = mergeNotificationPreferences(
    snap.data()?.notificationPreferences as Record<string, unknown> | undefined
  );
  return NextResponse.json({ ok: true, preferences: prefs });
}

export async function PUT(request: NextRequest) {
  const db = getAdminFirestore();
  const uid = await authUid(request);
  if (!db || !uid) {
    return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
  }

  let body: Partial<NotificationPreferenceGroups>;
  try {
    body = (await request.json()) as Partial<NotificationPreferenceGroups>;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }

  const current = mergeNotificationPreferences(
    (await db.collection("users").doc(uid).get()).data()?.notificationPreferences as
      | Record<string, unknown>
      | undefined
  );
  const next = { ...current, ...body };

  await db.collection("users").doc(uid).update({
    notificationPreferences: next,
    notificationPreferencesUpdatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, preferences: next });
}
