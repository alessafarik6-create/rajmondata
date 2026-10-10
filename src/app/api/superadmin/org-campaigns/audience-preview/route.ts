import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { resolveOrgCampaignRecipients } from "@/lib/platform-org-campaigns/recipient-resolver";
import type { OrgCampaignAudience } from "@/lib/platform-org-campaigns/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const body = (await request.json()) as { audience?: OrgCampaignAudience; search?: string };
  const recipients = await resolveOrgCampaignRecipients(db, body.audience ?? { mode: "all" }, body.search);
  const emailCount = recipients.filter((r) => r.contactEmail).length;
  return NextResponse.json({
    ok: true,
    count: recipients.length,
    emailCount,
    sample: recipients.slice(0, 20),
  });
}
