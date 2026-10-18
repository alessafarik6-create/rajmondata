import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { sendOrgCampaignTestEmail } from "@/lib/platform-org-campaigns/publish-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const body = (await request.json()) as { to?: string; subject?: string };
  const result = await sendOrgCampaignTestEmail(db, id, {
    to: String(body.to ?? ""),
    subject: body.subject,
    actorUsername: session.username,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    message:
      "E-mail byl předán poskytovateli k odeslání. Doručení do schránky není garantováno.",
    providerMessage: result.providerMessage,
  });
}
