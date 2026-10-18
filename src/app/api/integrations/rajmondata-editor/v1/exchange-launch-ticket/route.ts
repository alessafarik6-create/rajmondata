import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getRajmondataEditorEnv } from "@/lib/rajmondata-editor/config";
import { consumePortalLaunchTicket } from "@/lib/rajmondata-editor/launch-tickets.server";
import { ensureCompanyLicenseDoc } from "@/lib/company-license-admin";
import { canOrganizationUseModule } from "@/lib/rajmondata-editor/module-access";
import type { PlatformModuleCode } from "@/lib/platform-config";
import { PLATFORM_MODULE_CODES } from "@/lib/platform-config";

export const dynamic = "force-dynamic";

function authorize(request: NextRequest): boolean {
  const { secret } = getRajmondataEditorEnv();
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });

  const body = (await request.json()) as { ticketId?: string };
  const ticketId = String(body.ticketId ?? "").trim();
  if (!ticketId) return NextResponse.json({ error: "ticketId chybí." }, { status: 400 });

  const consumed = await consumePortalLaunchTicket(db, ticketId);
  if (!consumed.ok) return NextResponse.json({ error: consumed.error }, { status: 410 });

  const moduleCode = consumed.moduleCode as PlatformModuleCode;
  if (!(PLATFORM_MODULE_CODES as readonly string[]).includes(moduleCode)) {
    return NextResponse.json({ error: "Neplatný modul v ticketu." }, { status: 400 });
  }

  const license = await ensureCompanyLicenseDoc(db, consumed.organizationId);
  const access = canOrganizationUseModule(license, moduleCode);

  return NextResponse.json({
    organizationId: consumed.organizationId,
    organizationName: consumed.organizationName,
    userId: consumed.userId,
    email: consumed.email,
    displayName: consumed.displayName,
    moduleCode,
    licenseActive: access.ok,
  });
}
