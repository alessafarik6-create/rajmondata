import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { publishOrgCampaignAdmin } from "@/lib/platform-org-campaigns/publish-service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  let resendEmail = false;
  try {
    const body = (await request.json()) as { resendEmail?: boolean };
    resendEmail = body.resendEmail === true;
  } catch {
    /* empty */
  }
  try {
    const result = await publishOrgCampaignAdmin(db, id, {
      resendEmail,
      actorUsername: session.username,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Publikace selhala.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
