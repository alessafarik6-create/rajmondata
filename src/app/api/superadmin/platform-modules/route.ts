import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_MODULES_COLLECTION } from "@/lib/firestore-collections";
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
    const snap = await db.collection(PLATFORM_MODULES_COLLECTION).get();
    const modules = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ modules });
  } catch (e) {
    console.error("[superadmin platform-modules GET]", e);
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
    const modules = body.modules as Array<Record<string, unknown> & { code?: string }>;
    if (!Array.isArray(modules)) {
      return NextResponse.json({ error: "Očekáváno pole modules." }, { status: 400 });
    }

    await ensureAllPlatformData(db);
    const batch = db.batch();
    for (const m of modules) {
      const code = typeof m.code === "string" ? m.code : "";
      if (!code) continue;
      const ref = db.collection(PLATFORM_MODULES_COLLECTION).doc(code);
      batch.set(
        ref,
        {
          ...m,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
    console.info("[Platform]", "Platform modules updated", { by: session.username });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin platform-modules PUT]", e);
    return NextResponse.json({ error: "Chyba uložení." }, { status: 500 });
  }
}
