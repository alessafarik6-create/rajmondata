import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_SETTINGS_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_SETTINGS_DOC } from "@/lib/platform-config";
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
    const snap = await db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_SETTINGS_DOC).get();
    return NextResponse.json(snap.data() ?? {});
  } catch (e) {
    console.error("[superadmin platform-settings GET]", e);
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

    const num = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim()) {
        const n = Number(v.replace(",", ".").replace(/\s/g, ""));
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    };

    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: session.username,
    };
    const dep = num(body.defaultEmployeePriceCzk);
    if (dep !== undefined) patch.defaultEmployeePriceCzk = Math.max(0, Math.round(dep * 100) / 100);
    if (typeof body.promoNote === "string") patch.promoNote = body.promoNote.trim().slice(0, 2000);
    if (typeof body.landingHeadline === "string") patch.landingHeadline = body.landingHeadline.trim().slice(0, 300);
    if (typeof body.landingSubline === "string") patch.landingSubline = body.landingSubline.trim().slice(0, 500);

    await db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_SETTINGS_DOC).set(patch, { merge: true });
    console.info("[Platform]", "Platform settings updated", { by: session.username });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin platform-settings PUT]", e);
    const msg = e instanceof Error ? e.message : "Chyba uložení.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
