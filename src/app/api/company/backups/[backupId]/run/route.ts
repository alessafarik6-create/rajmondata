import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { callerCanReadOrganizationBackups } from "@/lib/organization-backup/permissions";
import { runOrganizationBackupJob } from "@/lib/organization-backup/export-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ backupId: string }> };

/** Pokračování dlouhé zálohy (kopírování souborů). */
export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const { backupId } = await ctx.params;
    const v = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    if (!callerCanReadOrganizationBackups(v.caller.role, v.caller.globalRoles)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }

    let done = false;
    let progress = await runOrganizationBackupJob(v.db, v.caller.companyId, backupId, v.caller.uid);
    let guard = 0;
    while (!progress.done && guard < 40) {
      guard += 1;
      progress = await runOrganizationBackupJob(v.db, v.caller.companyId, backupId, v.caller.uid);
      done = progress.done;
    }

    return NextResponse.json({ ok: true, progress });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
