import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { PLATFORM_ORG_CAMPAIGNS_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const snap = await db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = snap.data() as Record<string, unknown>;
  const ref = db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc();
  const { publishedAt: _p, publishBatchId: _b, stats: _s, ...rest } = data;
  await ref.set({
    ...rest,
    title: `${String(data.title ?? "Kampaň")} (kopie)`.slice(0, 200),
    status: "draft",
    stats: { targeted: 0, interested: 0, declined: 0, support: 0, opened: 0 },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: session.username,
    publishedAt: null,
    publishBatchId: null,
  });
  return NextResponse.json({ ok: true, id: ref.id });
}
