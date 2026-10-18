import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";

const DOC = "platform_settings/org_campaign_automation";

export type OrgCampaignAutomationSettings = {
  inactive14Enabled: boolean;
  inactive30Enabled: boolean;
  inactive60Enabled: boolean;
  subscriptionEndingEnabled: boolean;
  newAccountHelpEnabled: boolean;
  minDaysBetweenMarketingEmails: number;
};

const DEFAULTS: OrgCampaignAutomationSettings = {
  inactive14Enabled: false,
  inactive30Enabled: false,
  inactive60Enabled: false,
  subscriptionEndingEnabled: false,
  newAccountHelpEnabled: false,
  minDaysBetweenMarketingEmails: 7,
};

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const snap = await db.doc(DOC).get();
  return NextResponse.json({
    ok: true,
    settings: snap.exists ? { ...DEFAULTS, ...snap.data() } : DEFAULTS,
  });
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const body = (await request.json()) as Partial<OrgCampaignAutomationSettings>;
  await db.doc(DOC).set(
    { ...body, updatedAt: FieldValue.serverTimestamp(), updatedBy: session.username },
    { merge: true }
  );
  return NextResponse.json({ ok: true });
}
