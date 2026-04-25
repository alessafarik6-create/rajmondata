import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_SEO_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_SEO_DOC } from "@/lib/platform-config";
import {
  sanitizeHeroImages,
  sanitizePromoVideo,
} from "@/lib/platform-seo-sanitize";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  try {
    await ensureAllPlatformData(db);
    const snap = await db.collection(PLATFORM_SEO_COLLECTION).doc(PLATFORM_SEO_DOC).get();
    return NextResponse.json(snap.data() ?? {});
  } catch (e) {
    console.error("[superadmin seo GET]", e);
    return NextResponse.json({ error: "Chyba načtení." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    await ensureAllPlatformData(db);

    const patch: Record<string, unknown> = {
      pageKey: PLATFORM_SEO_DOC,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: session.username,
    };
    const s = (v: unknown, max: number) =>
      typeof v === "string" ? v.trim().slice(0, max) : "";
    if (typeof body.metaTitle === "string") patch.metaTitle = s(body.metaTitle, 200);
    if (typeof body.metaDescription === "string") patch.metaDescription = s(body.metaDescription, 500);
    if (typeof body.keywords === "string") patch.keywords = s(body.keywords, 500);
    if (typeof body.ogTitle === "string") patch.ogTitle = s(body.ogTitle, 200);
    if (typeof body.ogDescription === "string") patch.ogDescription = s(body.ogDescription, 500);
    if (typeof body.canonicalUrl === "string") patch.canonicalUrl = s(body.canonicalUrl, 500);
    if (typeof body.landingLead === "string") patch.landingLead = s(body.landingLead, 2000);
    if ("heroImages" in body) patch.heroImages = sanitizeHeroImages(body.heroImages);
    if ("promoVideo" in body) patch.promoVideo = sanitizePromoVideo(body.promoVideo);

    await db.collection(PLATFORM_SEO_COLLECTION).doc(PLATFORM_SEO_DOC).set(patch, { merge: true });
    console.info("[Platform]", "SEO settings updated", { by: session.username });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin seo PUT]", e);
    const msg = e instanceof Error ? e.message : "Chyba uložení.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
