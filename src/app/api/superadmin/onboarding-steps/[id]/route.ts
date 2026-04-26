import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";

const COLLECTION = "onboardingSteps";

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Přístup jen pro superadministrátora." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });

  const { id: rawId } = await ctx.params;
  const id = String(rawId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí ID." }, { status: 400 });

  let body: {
    title?: string;
    description?: string;
    route?: string;
    targetSelector?: string | null;
    order?: number;
    enabled?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: session.username,
  };
  if (body.title !== undefined) patch.title = String(body.title || "").trim();
  if (body.description !== undefined) patch.description = String(body.description || "").trim();
  if (body.route !== undefined) patch.route = String(body.route || "").trim();
  if (body.targetSelector !== undefined) {
    patch.targetSelector =
      typeof body.targetSelector === "string" && body.targetSelector.trim() ? body.targetSelector.trim() : null;
  }
  if (body.order !== undefined) patch.order = Number(body.order);
  if (body.enabled !== undefined) patch.enabled = body.enabled !== false;

  try {
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Krok neexistuje." }, { status: 404 });
    await ref.set(patch, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin onboarding-steps PATCH]", e);
    return NextResponse.json({ error: "Uložení se nezdařilo." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Přístup jen pro superadministrátora." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });

  const { id: rawId } = await ctx.params;
  const id = String(rawId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí ID." }, { status: 400 });

  try {
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Krok neexistuje." }, { status: 404 });
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin onboarding-steps DELETE]", e);
    return NextResponse.json({ error: "Smazání se nezdařilo." }, { status: 500 });
  }
}

