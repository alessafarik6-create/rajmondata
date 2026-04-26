import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import { softDeleteOrganizationAdmin } from "@/lib/organization-lifecycle-admin";

export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Smazání organizace může provést jen superadministrátor." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  const { id: rawId } = await ctx.params;
  const id = String(rawId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí ID organizace." }, { status: 400 });
  const snap = await db.collection(ORGANIZATIONS_COLLECTION).doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "Organizace neexistuje." }, { status: 404 });
  const data = snap.data() as Record<string, unknown>;
  if (data.isDeleted === true || String(data.status ?? "").toLowerCase() === "deleted") {
    return NextResponse.json({ error: "Organizace je již označena jako smazaná." }, { status: 409 });
  }
  try {
    await softDeleteOrganizationAdmin(db, id);
    return NextResponse.json({ ok: true, success: true });
  } catch (e) {
    console.error("[admin organizations soft-delete]", e);
    const msg = e instanceof Error ? e.message : "Operace se nezdařila.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
