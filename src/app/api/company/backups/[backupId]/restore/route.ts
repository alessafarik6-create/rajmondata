import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  buildRestoreConfirmationPhrase,
  callerCanRestoreOrganizationBackup,
} from "@/lib/organization-backup/permissions";
import { restoreOrganizationFromBackup } from "@/lib/organization-backup/restore-service";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ backupId: string }> };

type RestoreBody = { confirmationPhrase?: string };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const { backupId } = await ctx.params;
    const v = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    if (!callerCanRestoreOrganizationBackup(v.caller.role, v.caller.globalRoles)) {
      return NextResponse.json(
        { ok: false, error: "Obnovu smí spustit pouze majitel organizace." },
        { status: 403 }
      );
    }

    const companySnap = await v.db.collection(COMPANIES_COLLECTION).doc(v.caller.companyId).get();
    const companyData = companySnap.data() as { companyName?: string; name?: string } | undefined;
    const organizationName = String(companyData?.companyName || companyData?.name || v.caller.companyId);
    const expected = buildRestoreConfirmationPhrase(organizationName);

    const body = (await request.json()) as RestoreBody;
    const phrase = String(body.confirmationPhrase ?? "").trim().toUpperCase();
    if (phrase !== expected) {
      return NextResponse.json(
        {
          ok: false,
          error: `Pro potvrzení napište přesně: ${expected}`,
          expectedPhrase: expected,
        },
        { status: 400 }
      );
    }

    const result = await restoreOrganizationFromBackup(v.db, {
      organizationId: v.caller.companyId,
      backupId,
      userId: v.caller.uid,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      message: "Obnova dokončena. Před obnovou byl vytvořen PRE_RESTORE záloha.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
