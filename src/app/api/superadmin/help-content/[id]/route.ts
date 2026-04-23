import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { HELP_CONTENT_COLLECTION } from "@/lib/firestore-collections";
import { coerceHelpModuleToCanonical } from "@/lib/help-content";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Ctx) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Chybí id." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

    if ("companyId" in body) {
      const v = String(body.companyId ?? "global").trim() || "global";
      patch.companyId = v;
    }
    if ("module" in body) {
      const canon = coerceHelpModuleToCanonical(String(body.module ?? ""));
      if (!canon) {
        return NextResponse.json({ error: "Neplatný modul." }, { status: 400 });
      }
      patch.module = canon;
    }
    if ("question" in body) {
      const q = String(body.question ?? "").trim();
      if (!q) return NextResponse.json({ error: "Otázka nesmí být prázdná." }, { status: 400 });
      patch.question = q;
    }
    if ("answer" in body) {
      const a = String(body.answer ?? "").trim();
      if (!a) return NextResponse.json({ error: "Odpověď nesmí být prázdná." }, { status: 400 });
      patch.answer = a;
    }
    if ("keywords" in body) {
      patch.keywords = Array.isArray(body.keywords)
        ? body.keywords.map((k) => String(k ?? "").trim()).filter(Boolean)
        : [];
    }
    if ("order" in body) {
      const o = Number(body.order);
      patch.order = Number.isFinite(o) ? o : 0;
    }
    if ("isActive" in body) {
      patch.isActive = Boolean(body.isActive);
    }

    if (Object.keys(patch).length <= 1) {
      return NextResponse.json({ error: "Žádná pole k úpravě." }, { status: 400 });
    }

    await db.collection(HELP_CONTENT_COLLECTION).doc(id).set(patch, { merge: true });
    console.info("[HelpContent]", "patched", { id, by: session.username });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin help-content PATCH]", e);
    return NextResponse.json({ error: "Chyba uložení." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: Ctx) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Chybí id." }, { status: 400 });
  }

  try {
    await db.collection(HELP_CONTENT_COLLECTION).doc(id).delete();
    console.info("[HelpContent]", "deleted", { id, by: session.username });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin help-content DELETE]", e);
    return NextResponse.json({ error: "Chyba mazání." }, { status: 500 });
  }
}
