import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { createSupportTicketAdmin } from "@/lib/support-tickets-server";
import { loadCompanyDisplayName } from "@/lib/support-tickets-server";
import {
  COMPANIES_COLLECTION,
  PLATFORM_CAMPAIGN_INBOX_SUBCOLLECTION,
  PLATFORM_ORG_CAMPAIGNS_COLLECTION,
} from "@/lib/firestore-collections";
import type { OrgCampaignReactionKind } from "@/lib/platform-org-campaigns/types";

export const dynamic = "force-dynamic";

function canReact(caller: { role: string }) {
  return ["owner", "admin", "manager"].includes(caller.role);
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await ctx.params;
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ ok: false, error: "Server" }, { status: 503 });
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const caller = await verifyBearerAndLoadCaller(auth, db, token);
  if (!caller) return NextResponse.json({ ok: false, error: "Neautorizováno" }, { status: 401 });
  if (!canReact(caller)) {
    return NextResponse.json({ ok: false, error: "Nemáte oprávnění reagovat." }, { status: 403 });
  }
  const body = (await request.json()) as { reaction?: OrgCampaignReactionKind; message?: string };
  const reaction = body.reaction;
  if (!reaction || !["interested", "declined", "support"].includes(reaction)) {
    return NextResponse.json({ ok: false, error: "Neplatná reakce." }, { status: 400 });
  }
  const companyId = caller.companyId;
  const inboxRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(PLATFORM_CAMPAIGN_INBOX_SUBCOLLECTION)
    .doc(campaignId);
  const inboxSnap = await inboxRef.get();
  if (!inboxSnap.exists) {
    return NextResponse.json({ ok: false, error: "Zpráva není pro vaši organizaci." }, { status: 404 });
  }
  const existing = inboxSnap.data()?.reaction as string | undefined;
  if (existing && existing === reaction) {
    return NextResponse.json({ ok: true, already: true });
  }

  const inboxPatch: Record<string, unknown> = {
    reaction,
    reactedAt: FieldValue.serverTimestamp(),
    reactedByUserId: caller.uid,
  };
  if (reaction === "declined") {
    inboxPatch.hiddenFromDashboard = true;
    inboxPatch.status = "hidden";
  }

  await inboxRef.set(inboxPatch, { merge: true });
  await db
    .collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION)
    .doc(campaignId)
    .collection("recipients")
    .doc(companyId)
    .set(
      {
        reaction,
        reactedAt: FieldValue.serverTimestamp(),
        reactedByUserId: caller.uid,
      },
      { merge: true }
    );

  const campRef = db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(campaignId);
  const campSnap = await campRef.get();
  const stats = { ...((campSnap.data()?.stats as object) ?? {}) } as Record<string, number>;
  if (reaction === "interested") stats.interested = (stats.interested ?? 0) + 1;
  if (reaction === "declined") stats.declined = (stats.declined ?? 0) + 1;
  if (reaction === "support") stats.support = (stats.support ?? 0) + 1;
  await campRef.set({ stats }, { merge: true });

  let ticketId: string | null = null;
  if (reaction === "support") {
    const orgName = await loadCompanyDisplayName(db, companyId);
    const title = String(inboxSnap.data()?.title ?? "Nabídka RAJMONDATA");
    ticketId = await createSupportTicketAdmin(db, {
      organizationId: companyId,
      organizationName: orgName,
      type: "dotaz",
      subject: `Zájem o nabídku: ${title}`.slice(0, 300),
      firstMessage:
        String(body.message ?? "").trim() ||
        `Organizace reaguje na kampaň ${campaignId} (${title}).`,
      createdByUid: caller.uid,
    });
  }

  return NextResponse.json({ ok: true, ticketId });
}
