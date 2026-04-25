import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_SEO_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_SEO_DOC } from "@/lib/platform-config";
import {
  sanitizeHeroImages,
  sanitizeLoginImages,
  sanitizePromoVideo,
  sanitizeRegisterImages,
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
    if (typeof body.heroTitle === "string") patch.heroTitle = s(body.heroTitle, 300);
    if (typeof body.heroSubtitle === "string") patch.heroSubtitle = s(body.heroSubtitle, 500);
    if (typeof body.registerButtonText === "string") patch.registerButtonText = s(body.registerButtonText, 120);
    if (typeof body.loginButtonText === "string") patch.loginButtonText = s(body.loginButtonText, 120);
    if (typeof body.benefitsTitle === "string") patch.benefitsTitle = s(body.benefitsTitle, 200);
    if (typeof body.benefitsText === "string") patch.benefitsText = s(body.benefitsText, 4000);
    if (typeof body.pricingTitle === "string") patch.pricingTitle = s(body.pricingTitle, 200);
    if (typeof body.pricingSubtitle === "string") patch.pricingSubtitle = s(body.pricingSubtitle, 500);
    if (typeof body.registerPageTitle === "string") patch.registerPageTitle = s(body.registerPageTitle, 200);
    if (typeof body.registerPageSubtitle === "string") patch.registerPageSubtitle = s(body.registerPageSubtitle, 500);
    if (typeof body.registerPageHelperText === "string")
      patch.registerPageHelperText = s(body.registerPageHelperText, 2000);
    if (typeof body.loginPageTitle === "string") patch.loginPageTitle = s(body.loginPageTitle, 200);
    if (typeof body.loginPageSubtitle === "string") patch.loginPageSubtitle = s(body.loginPageSubtitle, 500);
    if (typeof body.loginWelcomeText === "string") patch.loginWelcomeText = s(body.loginWelcomeText, 200);
    if (typeof body.loginEmailLabel === "string") patch.loginEmailLabel = s(body.loginEmailLabel, 80);
    if (typeof body.loginPasswordLabel === "string") patch.loginPasswordLabel = s(body.loginPasswordLabel, 80);
    if ("heroImages" in body) patch.heroImages = sanitizeHeroImages(body.heroImages);
    if ("promoVideo" in body) patch.promoVideo = sanitizePromoVideo(body.promoVideo);
    if ("registerImages" in body) patch.registerImages = sanitizeRegisterImages(body.registerImages);
    if ("registerVideo" in body) patch.registerVideo = sanitizePromoVideo(body.registerVideo);
    if ("loginImages" in body) patch.loginImages = sanitizeLoginImages(body.loginImages);
    if ("loginVideo" in body) patch.loginVideo = sanitizePromoVideo(body.loginVideo);

    await db.collection(PLATFORM_SEO_COLLECTION).doc(PLATFORM_SEO_DOC).set(patch, { merge: true });
    console.info("[Platform]", "SEO settings updated", { by: session.username });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin seo PUT]", e);
    const msg = e instanceof Error ? e.message : "Chyba uložení.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
