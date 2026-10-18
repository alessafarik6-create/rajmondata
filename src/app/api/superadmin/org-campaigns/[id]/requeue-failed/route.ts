import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import {
  drainMailDispatchQueue,
  requeueFailedCampaignEmails,
} from "@/lib/email-notifications/process-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });

  const requeued = await requeueFailedCampaignEmails(db, id);
  const drained = await drainMailDispatchQueue(db, { maxRounds: 10, batchSize: 25 });
  return NextResponse.json({ ok: true, requeued, ...drained });
}
