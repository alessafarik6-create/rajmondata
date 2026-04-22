import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { HELP_CONTENT_COLLECTION } from "@/lib/firestore-collections";
import { HELP_PORTAL_MODULES } from "@/lib/help-content";

const MODULE_SET = new Set<string>(HELP_PORTAL_MODULES.map((m) => m.value));

function parseBody(body: unknown): {
  companyId: string;
  module: string;
  question: string;
  answer: string;
  keywords: string[];
  order: number;
  isActive: boolean;
} | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const companyId = String(o.companyId ?? "global").trim() || "global";
  const module = String(o.module ?? "").trim();
  if (!MODULE_SET.has(module)) return null;
  const question = String(o.question ?? "").trim();
  const answer = String(o.answer ?? "").trim();
  if (!question || !answer) return null;
  const keywords = Array.isArray(o.keywords)
    ? o.keywords.map((k) => String(k ?? "").trim()).filter(Boolean)
    : [];
  const order = Number(o.order);
  const isActive = o.isActive !== false;
  return {
    companyId,
    module,
    question,
    answer,
    keywords,
    order: Number.isFinite(order) ? order : 0,
    isActive,
  };
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const moduleFilter = request.nextUrl.searchParams.get("module")?.trim();
  try {
    const snap = await db.collection(HELP_CONTENT_COLLECTION).get();
    type Row = { id: string } & Record<string, unknown>;
    let items: Row[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    if (moduleFilter && MODULE_SET.has(moduleFilter)) {
      items = items.filter((row) => String(row.module ?? "") === moduleFilter);
    }
    items.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    return NextResponse.json({ items });
  } catch (e) {
    console.error("[superadmin help-content GET]", e);
    return NextResponse.json({ error: "Chyba načtení." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    const parsed = parseBody(body);
    if (!parsed) {
      return NextResponse.json({ error: "Neplatná data." }, { status: 400 });
    }

    const docRef = db.collection(HELP_CONTENT_COLLECTION).doc();
    await docRef.set({
      ...parsed,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.info("[HelpContent]", "created", { id: docRef.id, by: session.username });
    return NextResponse.json({ id: docRef.id });
  } catch (e) {
    console.error("[superadmin help-content POST]", e);
    return NextResponse.json({ error: "Chyba uložení." }, { status: 500 });
  }
}
