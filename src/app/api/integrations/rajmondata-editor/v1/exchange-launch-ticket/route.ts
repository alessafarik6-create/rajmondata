import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  isEditorIntegrationAuthorized,
  PORTAL_NONCE_HEADER,
  PORTAL_SIGNATURE_HEADER,
  PORTAL_TIMESTAMP_HEADER,
} from "@/lib/rajmondata-editor/portal-api-sign.server";
import { consumePortalLaunchTicket } from "@/lib/rajmondata-editor/launch-tickets.server";
import { ensureCompanyLicenseDoc } from "@/lib/company-license-admin";
import { canOrganizationUseModule } from "@/lib/rajmondata-editor/module-access";
import type { PlatformModuleCode } from "@/lib/platform-config";
import { PLATFORM_MODULE_CODES } from "@/lib/platform-config";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = randomBytes(8).toString("hex");
  let rawBody = "";
  try {
    rawBody = await request.text();
    if (
      !isEditorIntegrationAuthorized(
        request.headers.get("authorization"),
        rawBody,
        request.headers.get(PORTAL_SIGNATURE_HEADER),
        request.headers.get(PORTAL_TIMESTAMP_HEADER),
        request.headers.get(PORTAL_NONCE_HEADER)
      )
    ) {
      console.warn("[exchange-launch-ticket] unauthorized", { requestId });
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
    }

    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ error: "Server error", requestId }, { status: 503 });
    }

    const body = JSON.parse(rawBody || "{}") as { ticketId?: string; ticket?: string };
    const ticketId = String(body.ticketId ?? body.ticket ?? "").trim();
    if (!ticketId) {
      return NextResponse.json({ error: "ticketId chybí.", requestId }, { status: 400 });
    }

    const consumed = await consumePortalLaunchTicket(db, ticketId);
    if (!consumed.ok) {
      return NextResponse.json({ error: consumed.error, requestId }, { status: 410 });
    }

    const moduleCode = consumed.moduleCode as PlatformModuleCode;
    if (!(PLATFORM_MODULE_CODES as readonly string[]).includes(moduleCode)) {
      return NextResponse.json({ error: "Neplatný modul v ticketu.", requestId }, { status: 400 });
    }

    const license = await ensureCompanyLicenseDoc(db, consumed.organizationId);
    const access = canOrganizationUseModule(license, moduleCode);

    return NextResponse.json({
      ok: true,
      organizationId: consumed.organizationId,
      organizationName: consumed.organizationName,
      userId: consumed.userId,
      email: consumed.email,
      displayName: consumed.displayName,
      moduleCode,
      licenseActive: access.ok,
      requestId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[exchange-launch-ticket] unhandled", { requestId, message: msg });
    return NextResponse.json(
      { error: "Interní chyba při výměně ticketu.", requestId },
      { status: 500 }
    );
  }
}
