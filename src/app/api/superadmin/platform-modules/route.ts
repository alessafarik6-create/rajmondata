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
    /** Pozor: nesmíme při každém načtení znovu mergovat DEFAULT_PLATFORM_MODULES — přepsalo by uložené ceny. */
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
      const priceMonthly = Math.max(0, Number(m.priceMonthly ?? m.basePriceCzk) || 0);
      const isAtt = code === "attendance_payroll";
      const basePriceCzk = isAtt ? 0 : priceMonthly;
      const rawEp = Number(m.employeePriceCzk);
      const billingType =
        m.billingType === "per_employee" || m.billingType === "per_company" || m.billingType === "flat"
          ? m.billingType
          : isAtt
            ? "per_employee"
            : "per_company";
      const payload: Record<string, unknown> = {
        code,
        name: typeof m.name === "string" ? m.name.trim().slice(0, 200) : code,
        description: typeof m.description === "string" ? m.description.slice(0, 2000) : "",
        activeGlobally: m.activeGlobally === true,
        defaultEnabled: m.defaultEnabled === true,
        isPaid: m.isPaid === true,
        basePriceCzk,
        priceMonthly,
        currency: typeof m.currency === "string" ? m.currency.trim().slice(0, 8) : "CZK",
        billingPeriod: m.billingPeriod === "yearly" ? "yearly" : "monthly",
        billingType,
        configurableBySuperadmin: m.configurableBySuperadmin !== false,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: session.username,
      };
      if (isAtt) {
        payload.employeePriceCzk = Number.isFinite(rawEp) ? Math.max(0, rawEp) : 49;
      }
      batch.set(ref, payload, { merge: true });
    }
    await batch.commit();
    console.info("[Platform]", "Platform modules updated", { by: session.username });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin platform-modules PUT]", e);
    const msg = e instanceof Error ? e.message : "Chyba uložení.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
