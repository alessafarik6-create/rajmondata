import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { PLATFORM_ORG_CAMPAIGNS_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });

  const campSnap = await db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(id).get();
  if (!campSnap.exists) return NextResponse.json({ error: "Kampaň neexistuje." }, { status: 404 });

  const qs = await db
    .collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION)
    .doc(id)
    .collection("recipients")
    .limit(500)
    .get();

  const mailJobsSnap = await db
    .collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION)
    .doc(id)
    .collection("mailJobs")
    .limit(500)
    .get();
  const attemptsByOrg = new Map<string, number>();
  for (const d of mailJobsSnap.docs) {
    const o = String(d.data().organizationId ?? "");
    attemptsByOrg.set(o, Number(d.data().attempts ?? 0));
  }

  const recipients = qs.docs.map((d) => {
    const data = d.data();
    return {
      organizationId: d.id,
      ...data,
      emailAttempts: attemptsByOrg.get(d.id) ?? data.emailAttempts ?? 0,
    };
  });

  const stats = (campSnap.data()?.stats ?? {}) as Record<string, number | undefined>;

  return NextResponse.json({
    ok: true,
    stats,
    recipients,
  });
}
