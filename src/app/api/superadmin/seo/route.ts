import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_SEO_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_SEO_DOC } from "@/lib/platform-config";
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
    const body = await request.json();
    await ensureAllPlatformData(db);
    await db
      .collection(PLATFORM_SEO_COLLECTION)
      .doc(PLATFORM_SEO_DOC)
      .set(
        {
          ...body,
          pageKey: PLATFORM_SEO_DOC,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    console.info("[Platform]", "SEO settings updated", { by: session.username });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin seo PUT]", e);
    return NextResponse.json({ error: "Chyba uložení." }, { status: 500 });
  }
}
