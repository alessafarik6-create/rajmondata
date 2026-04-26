import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import { PLATFORM_INVOICES_COLLECTION } from "@/lib/firestore-collections";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";

type PatchBody = {
  status?: "paid" | "unpaid" | "cancelled";
};

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ invoiceId: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Mazání faktur je povoleno jen superadministrátorovi." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  const { invoiceId } = await ctx.params;
  const id = String(invoiceId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí invoiceId." }, { status: 400 });
  try {
    await ensureAllPlatformData(db);
    const ref = db.collection(PLATFORM_INVOICES_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Faktura neexistuje." }, { status: 404 });
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const storagePath = typeof data.storagePath === "string" ? data.storagePath.trim() : "";
    if (storagePath) {
      try {
        const bucket = getAdminStorageBucket();
        if (bucket) await bucket.file(storagePath).delete({ ignoreNotFound: true });
      } catch (e) {
        console.warn("[superadmin platform-invoices DELETE] storage", e);
      }
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin platform-invoices DELETE]", e);
    const msg = e instanceof Error ? e.message : "Smazání se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ invoiceId: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  const { invoiceId } = await ctx.params;
  const id = String(invoiceId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí invoiceId." }, { status: 400 });
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }
  const st = body.status;
  if (st !== "paid" && st !== "unpaid" && st !== "cancelled") {
    return NextResponse.json({ error: "status musí být paid, unpaid nebo cancelled." }, { status: 400 });
  }
  try {
    await ensureAllPlatformData(db);
    const ref = db.collection(PLATFORM_INVOICES_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Faktura neexistuje." }, { status: 404 });
    const patch: Record<string, unknown> = {
      status: st,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: session.username,
    };
    if (st === "paid") {
      patch.paidAt = FieldValue.serverTimestamp();
      patch.paymentClaimed = false;
      patch.paymentClaimedAt = null;
      patch.gracePeriodUntil = null;
      patch.paymentClaimedByUid = null;
      patch.graceDeactivationApplied = false;
    } else {
      patch.paidAt = null;
    }
    await ref.set(patch, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin platform-invoices PATCH]", e);
    const msg = e instanceof Error ? e.message : "Uložení se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
