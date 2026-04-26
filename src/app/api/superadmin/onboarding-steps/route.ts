import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";

const COLLECTION = "onboardingSteps";

function numOr(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Přístup jen pro superadministrátora." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });

  try {
    const snap = await db.collection(COLLECTION).get();
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string } & Record<string, unknown>)
      .sort((a, b) => numOr(a.order, 0) - numOr(b.order, 0));
    return NextResponse.json({ steps: rows });
  } catch (e) {
    console.error("[superadmin onboarding-steps GET]", e);
    return NextResponse.json({ error: "Načtení se nezdařilo." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Přístup jen pro superadministrátora." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });

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

  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const route = String(body.route || "").trim();
  const targetSelector =
    typeof body.targetSelector === "string" && body.targetSelector.trim()
      ? body.targetSelector.trim()
      : null;
  const enabled = body.enabled !== false;

  if (!title || !description || !route) {
    return NextResponse.json({ error: "Vyplňte title, description a route." }, { status: 400 });
  }

  try {
    const snap = await db.collection(COLLECTION).get();
    const maxOrder = snap.docs.reduce((m, d) => Math.max(m, numOr(d.data()?.order, 0)), 0);
    const order = Number.isFinite(body.order as number) ? Number(body.order) : maxOrder + 1;
    const ref = db.collection(COLLECTION).doc();
    await ref.set({
      title,
      description,
      route,
      targetSelector,
      order,
      enabled,
      createdAt: new Date(),
      createdBy: session.username,
      updatedAt: new Date(),
      updatedBy: session.username,
    });
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e) {
    console.error("[superadmin onboarding-steps POST]", e);
    return NextResponse.json({ error: "Uložení se nezdařilo." }, { status: 500 });
  }
}

