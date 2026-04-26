import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_SETTINGS_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_PRICING_DOC } from "@/lib/platform-config";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  try {
    await ensureAllPlatformData(db);
    const snap = await db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_PRICING_DOC).get();
    return NextResponse.json(snap.data() ?? {});
  } catch (e) {
    console.error("[platform-pricing GET]", e);
    return NextResponse.json({ error: "Chyba načtení." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    await ensureAllPlatformData(db);
    const num = (v: unknown, fb: number) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : fb;
    };
    const ref = db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_PRICING_DOC);
    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: session.username,
    };
    if (body.baseLicenseMonthlyCzk !== undefined) {
      patch.baseLicenseMonthlyCzk = Math.max(0, Math.round(num(body.baseLicenseMonthlyCzk, 0) * 100) / 100);
    }
    if (body.defaultVatPercent !== undefined) {
      patch.defaultVatPercent = Math.max(0, Math.min(100, Math.round(num(body.defaultVatPercent, 21))));
    }
    if (body.automationDefaultIntervalDays !== undefined) {
      patch.automationDefaultIntervalDays = Math.max(
        1,
        Math.round(num(body.automationDefaultIntervalDays, 30))
      );
    }
    if (body.automationDefaultDueDays !== undefined) {
      patch.automationDefaultDueDays = Math.max(1, Math.round(num(body.automationDefaultDueDays, 14)));
    }
    await ref.set(patch, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[platform-pricing PUT]", e);
    const msg = e instanceof Error ? e.message : "Chyba uložení.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
