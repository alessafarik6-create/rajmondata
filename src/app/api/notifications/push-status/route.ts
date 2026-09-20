import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  ensureWebPushVapid,
  getVapidPublicKey,
} from "@/lib/notification-service/notification-service";

export async function GET(request: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) {
    return NextResponse.json({ ok: false, error: "Server není připraven." }, { status: 503 });
  }

  const idToken = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!idToken) {
    return NextResponse.json({ ok: false, error: "Chybí token." }, { status: 401 });
  }

  let uid: string;
  try {
    uid = (await auth.verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný token." }, { status: 401 });
  }

  const vapidConfigured = Boolean(getVapidPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim());
  const vapidValid = vapidConfigured && ensureWebPushVapid();

  const subsSnap = await db
    .collection("users")
    .doc(uid)
    .collection("pushSubscriptions")
    .where("isActive", "==", true)
    .limit(20)
    .get()
    .catch(() => db.collection("users").doc(uid).collection("pushSubscriptions").limit(20).get());

  const activeSubs = subsSnap.docs.filter((d) => d.data().isActive !== false);
  const last = activeSubs
    .map((d) => d.data() as { lastUsedAt?: { toDate?: () => Date }; lastPushError?: string })
    .sort((a, b) => {
      const ta = a.lastUsedAt?.toDate?.()?.getTime() ?? 0;
      const tb = b.lastUsedAt?.toDate?.()?.getTime() ?? 0;
      return tb - ta;
    })[0];

  const userSnap = await db.collection("users").doc(uid).get();
  const role = String(userSnap.data()?.role ?? "");

  return NextResponse.json({
    ok: true,
    vapidConfigured,
    vapidValid,
    serviceWorkerPath: "/sw.js",
    subscriptionActive: activeSubs.length > 0,
    activeDeviceCount: activeSubs.length,
    lastPushAt: last?.lastUsedAt?.toDate?.()?.toISOString?.() ?? null,
    lastPushError: last?.lastPushError ?? null,
    isAdminDiagnostics: role === "owner" || role === "admin",
  });
}
