import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  ensureWebPushVapid,
  getVapidPublicKey,
} from "@/lib/notification-service/notification-service";
import {
  isPushSubscriptionActive,
  loadActivePushSubscriptions,
  pushSubscriptionStorageDocId,
} from "@/lib/notification-service/push-delivery";

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

function buildPushStatusPayload(params: {
  uid: string;
  db: FirebaseFirestore.Firestore;
  currentEndpoint?: string | null;
}) {
  const { uid, db, currentEndpoint } = params;
  const vapidConfigured = Boolean(getVapidPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim());
  const vapidValid = vapidConfigured && ensureWebPushVapid();

  return (async () => {
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data() ?? {};
    const role = String(userData.role ?? "");
    const organizationId = String(userData.companyId ?? userData.organizationId ?? "").trim();

    const activeSubs = await loadActivePushSubscriptions(db, uid, organizationId || null);
    const currentTrim = currentEndpoint?.trim() || "";
    const currentDocId = currentTrim ? pushSubscriptionStorageDocId(currentTrim) : null;

    const devices = activeSubs.map((s) => {
      const docId = pushSubscriptionStorageDocId(s.endpoint);
      const label = [s.platform, s.deviceName].filter(Boolean).join(" / ") || "Zařízení";
      return {
        id: docId,
        label,
        platform: s.platform ?? "Web",
        deviceName: s.deviceName ?? "Prohlížeč",
        isCurrentDevice: currentDocId != null && docId === currentDocId,
      };
    });

    const allSnap = await db.collection("users").doc(uid).collection("pushSubscriptions").get();
    const legacyReactivated = allSnap.docs.filter((d) => {
      const data = d.data() as Record<string, unknown>;
      return isPushSubscriptionActive(data);
    }).length;

    const last = allSnap.docs
      .map((d) => d.data() as { lastUsedAt?: { toDate?: () => Date }; lastPushError?: string })
      .sort((a, b) => {
        const ta = a.lastUsedAt?.toDate?.()?.getTime() ?? 0;
        const tb = b.lastUsedAt?.toDate?.()?.getTime() ?? 0;
        return tb - ta;
      })[0];

    const serverRegisteredThisDevice =
      currentDocId != null && devices.some((d) => d.isCurrentDevice);

    return NextResponse.json({
      ok: true,
      vapidConfigured,
      vapidValid,
      serviceWorkerPath: "/sw.js",
      subscriptionActive: activeSubs.length > 0,
      activeDeviceCount: activeSubs.length,
      serverRegisteredThisDevice: currentTrim ? serverRegisteredThisDevice : null,
      devices,
      legacyActiveCount: legacyReactivated,
      lastPushAt: last?.lastUsedAt?.toDate?.()?.toISOString?.() ?? null,
      lastPushError: last?.lastPushError ?? null,
      isAdminDiagnostics: role === "owner" || role === "admin",
    });
  })();
}

export async function GET(request: NextRequest) {
  const db = getAdminFirestore();
  const uid = await authUid(request);
  if (!db || !uid) {
    return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
  }
  const currentEndpoint = request.nextUrl.searchParams.get("currentEndpoint");
  return buildPushStatusPayload({ uid, db, currentEndpoint });
}

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const uid = await authUid(request);
  if (!db || !uid) {
    return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
  }
  let currentEndpoint: string | null = null;
  try {
    const body = (await request.json()) as { currentEndpoint?: string };
    currentEndpoint =
      typeof body.currentEndpoint === "string" ? body.currentEndpoint.trim() : null;
  } catch {
    currentEndpoint = null;
  }
  return buildPushStatusPayload({ uid, db, currentEndpoint });
}
