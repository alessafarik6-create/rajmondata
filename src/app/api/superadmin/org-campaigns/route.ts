import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { PLATFORM_ORG_CAMPAIGNS_COLLECTION } from "@/lib/firestore-collections";
import { sanitizeCampaignHtml } from "@/lib/platform-org-campaigns/sanitize";
import type { OrgCampaignAudience, OrgCampaignType } from "@/lib/platform-org-campaigns/types";

export const dynamic = "force-dynamic";

function normalizeType(raw: string): OrgCampaignType {
  const t = raw.trim();
  if (["message", "news", "offer", "promo", "alert", "support"].includes(t)) return t as OrgCampaignType;
  return "message";
}

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const snap = await db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).orderBy("updatedAt", "desc").limit(200).get();
  const campaigns = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return NextResponse.json({ ok: true, campaigns });
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const body = (await request.json()) as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "Chybí nadpis." }, { status: 400 });
  const audience = (body.audience ?? { mode: "all" }) as OrgCampaignAudience;
  const ref = db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc();
  await ref.set({
    title,
    shortDescription: String(body.shortDescription ?? "").trim().slice(0, 500),
    bodyHtml: sanitizeCampaignHtml(String(body.bodyHtml ?? "")),
    type: normalizeType(String(body.type ?? "message")),
    status: "draft",
    audience,
    imageUrl: body.imageUrl ? String(body.imageUrl) : null,
    ctaLabel: String(body.ctaLabel ?? "Zjistit více").slice(0, 80),
    ctaUrl: body.ctaUrl ? String(body.ctaUrl).slice(0, 500) : null,
    emailNotify: body.emailNotify === true,
    emailSubject: String(body.emailSubject ?? "").slice(0, 200) || null,
    emailHtml: body.emailHtml ? sanitizeCampaignHtml(String(body.emailHtml)) : null,
    emailMarketing: body.emailMarketing === true,
    stats: { targeted: 0, interested: 0, declined: 0, support: 0, opened: 0 },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: session.username,
  });
  return NextResponse.json({ ok: true, id: ref.id });
}
