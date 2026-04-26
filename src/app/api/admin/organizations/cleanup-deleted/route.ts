import { NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { purgeExpiredSoftDeletedOrganizationsAdmin } from "@/lib/organization-lifecycle-admin";

export async function POST() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Vyčištění smazaných organizací může spustit jen superadministrátor." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  try {
    const result = await purgeExpiredSoftDeletedOrganizationsAdmin(db);
    return NextResponse.json({ ok: true, success: true, ...result });
  } catch (e) {
    console.error("[admin organizations cleanup-deleted]", e);
    const msg = e instanceof Error ? e.message : "Operace se nezdařila.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
