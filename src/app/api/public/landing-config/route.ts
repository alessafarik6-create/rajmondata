import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  PLATFORM_SETTINGS_COLLECTION,
  PLATFORM_SEO_COLLECTION,
  PLATFORM_MODULES_COLLECTION,
} from "@/lib/firestore-collections";
import { PLATFORM_SETTINGS_DOC, PLATFORM_SEO_DOC } from "@/lib/platform-config";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";

/**
 * Veřejný endpoint pro úvodní stránku (ceny, SEO texty). Bez autentizace — čte přes Admin SDK.
 */
export async function GET() {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json(
      {
        settings: null,
        seo: null,
        modules: [],
        error: "admin_unconfigured",
      },
      { status: 200 }
    );
  }

  try {
    await ensureAllPlatformData(db);
    const [settingsSnap, seoSnap, modulesSnap] = await Promise.all([
      db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_SETTINGS_DOC).get(),
      db.collection(PLATFORM_SEO_COLLECTION).doc(PLATFORM_SEO_DOC).get(),
      db.collection(PLATFORM_MODULES_COLLECTION).get(),
    ]);

    return NextResponse.json({
      settings: settingsSnap.data() ?? {},
      seo: seoSnap.data() ?? {},
      modules: modulesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
  } catch (e) {
    console.error("[public landing-config]", e);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}
