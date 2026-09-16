import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není k dispozici." }, { status: 503 });

  const snap = await db
    .collection(PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(40)
    .get();

  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const unreadCount = items.filter((x) => !(x as { readAt?: unknown }).readAt).length;

  return NextResponse.json({ ok: true, items, unreadCount });
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není k dispozici." }, { status: 503 });

  const body = (await request.json()) as { id?: string; markAllRead?: boolean };
  if (body.markAllRead) {
    const recent = await db
      .collection(PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    const batch = db.batch();
    let marked = 0;
    for (const doc of recent.docs) {
      if (doc.data()?.readAt) continue;
      batch.update(doc.ref, { readAt: FieldValue.serverTimestamp() });
      marked += 1;
    }
    if (marked > 0) await batch.commit();
    return NextResponse.json({ ok: true, marked });
  }

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Chybí id." }, { status: 400 });
  await db.collection(PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION).doc(id).update({
    readAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ ok: true });
}
