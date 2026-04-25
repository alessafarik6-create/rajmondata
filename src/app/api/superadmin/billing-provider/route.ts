import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_SETTINGS_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_BILLING_PROVIDER_DOC } from "@/lib/platform-config";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  try {
    await ensureAllPlatformData(db);
    const snap = await db
      .collection(PLATFORM_SETTINGS_COLLECTION)
      .doc(PLATFORM_BILLING_PROVIDER_DOC)
      .get();
    return NextResponse.json(snap.data() ?? {});
  } catch (e) {
    console.error("[superadmin billing-provider GET]", e);
    return NextResponse.json({ error: "Chyba načtení." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  try {
    await ensureAllPlatformData(db);
    const body = (await request.json()) as Record<string, unknown>;
    const str = (k: string, max: number) =>
      typeof body[k] === "string" ? String(body[k]).trim().slice(0, max) : "";
    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: session.username,
      companyName: str("companyName", 300),
      address: str("address", 2000),
      ico: str("ico", 20),
      dic: str("dic", 30),
      email: str("email", 200),
      phone: str("phone", 80),
      accountNumber: str("accountNumber", 80),
      iban: str("iban", 42).replace(/\s/g, "").toUpperCase(),
      swift: str("swift", 20).toUpperCase(),
      logoUrl: typeof body.logoUrl === "string" ? body.logoUrl.trim().slice(0, 2000) || null : null,
      stampUrl: typeof body.stampUrl === "string" ? body.stampUrl.trim().slice(0, 2000) || null : null,
      invoiceFooterText: str("invoiceFooterText", 4000),
    };
    await db
      .collection(PLATFORM_SETTINGS_COLLECTION)
      .doc(PLATFORM_BILLING_PROVIDER_DOC)
      .set(patch, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin billing-provider PUT]", e);
    const msg = e instanceof Error ? e.message : "Chyba uložení.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
