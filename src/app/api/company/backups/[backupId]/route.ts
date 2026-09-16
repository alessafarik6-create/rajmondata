import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { callerCanReadOrganizationBackups } from "@/lib/organization-backup/permissions";
import { readBackupManifest, verifyManifestChecksum } from "@/lib/organization-backup/export-service";
import { markOrganizationBackupForDeletion } from "@/lib/organization-backup/cleanup-admin";
import { logOrganizationBackupAuditAdmin } from "@/lib/organization-backup/audit-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { ORGANIZATION_BACKUPS_SUBCOLLECTION } from "@/lib/organization-backup/constants";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ backupId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const { backupId } = await ctx.params;
    const v = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    if (!callerCanReadOrganizationBackups(v.caller.role, v.caller.globalRoles)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }

    const ref = v.db
      .collection(COMPANIES_COLLECTION)
      .doc(v.caller.companyId)
      .collection(ORGANIZATION_BACKUPS_SUBCOLLECTION)
      .doc(backupId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Záloha nenalezena." }, { status: 404 });
    }
    const data = snap.data() as { storagePath?: string; organizationId?: string };
    let manifest = null;
    if (data.storagePath) {
      manifest = await readBackupManifest(v.caller.companyId, backupId, String(data.storagePath));
      if (manifest && !verifyManifestChecksum(manifest)) {
        return NextResponse.json({ ok: false, error: "Záloha neprošla kontrolou integrity." }, { status: 422 });
      }
    }

    return NextResponse.json({ ok: true, backup: { id: snap.id, ...snap.data() }, manifest });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    const { backupId } = await ctx.params;
    const v = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    if (!callerCanReadOrganizationBackups(v.caller.role, v.caller.globalRoles)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }
    if (v.caller.role !== "owner" && !v.caller.globalRoles.includes("super_admin")) {
      return NextResponse.json({ ok: false, error: "Smazat zálohu může pouze majitel." }, { status: 403 });
    }

    await markOrganizationBackupForDeletion(v.db, v.caller.companyId, backupId);
    await logOrganizationBackupAuditAdmin(v.db, {
      organizationId: v.caller.companyId,
      userId: v.caller.uid,
      backupId,
      action: "backup_delete_requested",
      status: "ok",
    });

    return NextResponse.json({ ok: true, pendingDeletion: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
