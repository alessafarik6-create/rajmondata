import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { pushSubscriptionStorageDocId } from "@/lib/portal-notifications-server";

type PushBody = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: { p256dh?: string; auth?: string };
};

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: "Firebase Admin není k dispozici." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) {
    return NextResponse.json({ error: "Chybí Authorization Bearer token." }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  let body: PushBody;
  try {
    body = (await request.json()) as PushBody;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const authKey = typeof body.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "Neplatná push subscription." }, { status: 400 });
  }

  const userSnap = await db.collection("users").doc(uid).get();
  const organizationId = String(userSnap.data()?.companyId ?? userSnap.data()?.organizationId ?? "").trim();
  const ua = request.headers.get("user-agent") ?? "";
  const platform =
    request.headers.get("sec-ch-ua-platform")?.replace(/"/g, "") ||
    (ua.includes("Android") ? "Android" : ua.includes("iPhone") ? "iOS" : "Web");

  let deviceName = "Prohlížeč";
  if (ua.includes("Edg/")) deviceName = "Edge";
  else if (ua.includes("Chrome/")) deviceName = "Chrome";
  else if (ua.includes("Firefox/")) deviceName = "Firefox";
  else if (ua.includes("Safari/") && !ua.includes("Chrome")) deviceName = "Safari";

  const docId = pushSubscriptionStorageDocId(endpoint);
  const ref = db.collection("users").doc(uid).collection("pushSubscriptions").doc(docId);
  const existing = await ref.get();
  await ref.set(
    {
      organizationId: organizationId || null,
      userId: uid,
      deviceId: docId,
      endpoint,
      keys: { p256dh, auth: authKey },
      deviceName,
      userAgent: ua.slice(0, 500),
      platform,
      enabled: true,
      isActive: true,
      failedCount: 0,
      lastSeenAt: FieldValue.serverTimestamp(),
      lastUsedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, subscriptionId: docId });
}

export async function DELETE(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: "Firebase Admin není k dispozici." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) {
    return NextResponse.json({ error: "Chybí Authorization Bearer token." }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  let endpoint = "";
  try {
    const body = (await request.json()) as { endpoint?: string };
    endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }
  if (!endpoint) {
    return NextResponse.json({ error: "Chybí endpoint." }, { status: 400 });
  }

  const docId = pushSubscriptionStorageDocId(endpoint);
  await db.collection("users").doc(uid).collection("pushSubscriptions").doc(docId).delete();

  return NextResponse.json({ ok: true });
}
