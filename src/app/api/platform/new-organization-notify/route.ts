import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { canTriggerNewOrganizationNotify } from "@/lib/platform-admin-notifications/access";
import { notifySuperadminNewOrganizationRegistered } from "@/lib/platform-admin-notifications/new-organization-notify";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = { organizationId?: string; source?: string };

export async function POST(request: NextRequest) {
  try {
    const v = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    }

    const body = (await request.json().catch(() => ({}))) as Body;
    const organizationId = String(body.organizationId ?? v.caller.companyId).trim();
    if (!organizationId || organizationId !== v.caller.companyId) {
      return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
    }
    const orgSnap = await v.db.collection(COMPANIES_COLLECTION).doc(organizationId).get();
    if (!orgSnap.exists) {
      return NextResponse.json({ ok: false, error: "Organizace neexistuje." }, { status: 404 });
    }
    const org = orgSnap.data() as { ownerId?: string; ownerUserId?: string };
    const ownerIdRaw = String(org.ownerUserId || org.ownerId || "").trim();
    const organizationOwnerId = ownerIdRaw || null;
    if (
      !canTriggerNewOrganizationNotify({
        role: v.caller.role,
        globalRoles: v.caller.globalRoles,
        callerUid: v.caller.uid,
        callerCompanyId: v.caller.companyId,
        organizationId,
        organizationOwnerId,
      })
    ) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const result = await notifySuperadminNewOrganizationRegistered(v.db, {
      organizationId,
      ownerUserId: v.caller.uid,
      source: body.source ?? "public_register",
    });

    return NextResponse.json({ ...result, ok: result.ok });
  } catch (e) {
    console.error("[api/platform/new-organization-notify]", e);
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
