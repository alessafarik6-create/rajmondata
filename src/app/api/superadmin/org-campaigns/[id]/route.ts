import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { PLATFORM_ORG_CAMPAIGNS_COLLECTION } from "@/lib/firestore-collections";
import { sanitizeCampaignHtml } from "@/lib/platform-org-campaigns/sanitize";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const snap = await db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const recipientsSnap = await snap.ref.collection("recipients").limit(500).get();
  return NextResponse.json({
    ok: true,
    campaign: { id: snap.id, ...snap.data() },
    recipients: recipientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const body = (await request.json()) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: session.username };
  if (body.title != null) patch.title = String(body.title).trim().slice(0, 200);
  if (body.shortDescription != null) patch.shortDescription = String(body.shortDescription).trim().slice(0, 500);
  if (body.bodyHtml != null) patch.bodyHtml = sanitizeCampaignHtml(String(body.bodyHtml));
  if (body.type != null) patch.type = String(body.type);
  if (body.audience != null) patch.audience = body.audience;
  if (body.status != null) patch.status = String(body.status);
  if (body.imageUrl != null) patch.imageUrl = body.imageUrl ? String(body.imageUrl) : null;
  if (body.ctaLabel != null) patch.ctaLabel = String(body.ctaLabel).slice(0, 80);
  if (body.ctaUrl != null) patch.ctaUrl = body.ctaUrl ? String(body.ctaUrl) : null;
  if (body.emailNotify != null) patch.emailNotify = body.emailNotify === true;
  if (body.emailSubject != null) patch.emailSubject = String(body.emailSubject).slice(0, 200);
  if (body.emailHtml != null) patch.emailHtml = body.emailHtml ? sanitizeCampaignHtml(String(body.emailHtml)) : null;
  if (body.publishAt != null) {
    patch.publishAt = body.publishAt ? Timestamp.fromDate(new Date(String(body.publishAt))) : null;
  }
  if (body.endAt != null) {
    patch.endAt = body.endAt ? Timestamp.fromDate(new Date(String(body.endAt))) : null;
  }
  await db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(id).set(patch, { merge: true });
  await db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(id).collection("audit").add({
    action: "update",
    at: FieldValue.serverTimestamp(),
    actor: session.username,
  });
  return NextResponse.json({ ok: true });
}
