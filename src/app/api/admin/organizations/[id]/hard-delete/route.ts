import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import { hardDeleteOrganizationTenantAdmin } from "@/lib/organization-lifecycle-admin";

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Trvalé smazání může provést jen superadministrátor." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  const { id: rawId } = await ctx.params;
  const id = String(rawId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí ID organizace." }, { status: 400 });
  const force = request.nextUrl.searchParams.get("force") === "1";
  const snap = await db.collection(ORGANIZATIONS_COLLECTION).doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "Organizace neexistuje." }, { status: 404 });
  const data = snap.data() as Record<string, unknown>;
  if (data.isDeleted !== true && String(data.status ?? "").toLowerCase() !== "deleted") {
    return NextResponse.json(
      { error: "Trvalě lze smazat jen organizaci ve stavu soft delete." },
      { status: 400 }
    );
  }
  if (!force) {
    const sched = data.deletionScheduledAt as Timestamp | undefined;
    if (sched && typeof sched.toMillis === "function" && sched.toMillis() > Date.now()) {
      return NextResponse.json(
        {
          error:
            "Trvalé smazání bude možné až po uplynutí lhůty, nebo použijte parametr force=1 (pouze superadmin).",
        },
        { status: 400 }
      );
    }
  }
  try {
    await hardDeleteOrganizationTenantAdmin(db, id);
    return NextResponse.json({ ok: true, success: true });
  } catch (e) {
    console.error("[admin organizations hard-delete]", e);
    const msg = e instanceof Error ? e.message : "Operace se nezdařila.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
