import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import {
  resolveOrgCampaignRecipients,
  type OrgLicenseFilter,
} from "@/lib/platform-org-campaigns/recipient-resolver";
import type { OrgCampaignAudience } from "@/lib/platform-org-campaigns/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });

  const sp = request.nextUrl.searchParams;
  const search = sp.get("search") ?? "";
  const licenseFilter = (sp.get("licenseFilter") ?? "all") as OrgLicenseFilter;
  const marketing = sp.get("emailMarketing") !== "false";
  const mode = sp.get("mode") ?? "all";

  const audience: OrgCampaignAudience =
    mode === "selected"
      ? { mode: "selected", companyIds: [] }
      : { mode: mode as OrgCampaignAudience["mode"] };

  const rows = await resolveOrgCampaignRecipients(db, audience, search, {
    requireMarketingConsent: marketing,
    licenseFilter,
  });

  return NextResponse.json({
    ok: true,
    organizations: rows.map((r) => ({
      id: r.companyId,
      name: r.name,
      ico: r.ico,
      email: r.contactEmail,
      licenseStatus: r.licenseStatus,
      planKey: r.planKey,
      marketingUnsubscribed: r.marketingUnsubscribed,
      hasValidEmail: Boolean(r.contactEmail),
    })),
    count: rows.length,
  });
}
