import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  callerCanCreateOrganizationBackup,
  callerCanReadOrganizationBackups,
} from "@/lib/organization-backup/permissions";
import {
  createOrganizationBackupRecord,
  runOrganizationBackupJob,
} from "@/lib/organization-backup/export-service";
import { logOrganizationBackupAuditAdmin } from "@/lib/organization-backup/audit-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { ORGANIZATION_BACKUPS_SUBCOLLECTION } from "@/lib/organization-backup/constants";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const v = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    if (!callerCanReadOrganizationBackups(v.caller.role, v.caller.globalRoles)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění k zálohám." }, { status: 403 });
    }

    const snap = await v.db
      .collection(COMPANIES_COLLECTION)
      .doc(v.caller.companyId)
      .collection(ORGANIZATION_BACKUPS_SUBCOLLECTION)
      .orderBy("createdAt", "desc")
      .limit(80)
      .get();

    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const lastOk = items.find((x) => (x as { status?: string }).status === "COMPLETED");

    return NextResponse.json({
      ok: true,
      items,
      monitoring: {
        lastSuccessfulAt: (lastOk as { completedAt?: unknown })?.completedAt ?? null,
        health: items.some((x) => (x as { status?: string }).status === "FAILED") ? "error" : "ok",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}

type CreateBody = { backupType?: "MANUAL" | "EXPORT" };

export async function POST(request: NextRequest) {
  try {
    const v = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    if (!callerCanCreateOrganizationBackup(v.caller.role, v.caller.globalRoles)) {
      return NextResponse.json({ ok: false, error: "Zálohu může vytvořit pouze admin." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as CreateBody;
    const backupType = body.backupType === "EXPORT" ? "EXPORT" : "MANUAL";

    const companySnap = await v.db.collection(COMPANIES_COLLECTION).doc(v.caller.companyId).get();
    const companyData = companySnap.data() as { companyName?: string; name?: string } | undefined;
    const organizationName = String(companyData?.companyName || companyData?.name || v.caller.companyId);

    const backupId = await createOrganizationBackupRecord(v.db, {
      organizationId: v.caller.companyId,
      organizationName,
      backupType,
      createdBy: v.caller.uid,
    });

    await logOrganizationBackupAuditAdmin(v.db, {
      organizationId: v.caller.companyId,
      userId: v.caller.uid,
      backupId,
      action: "backup_create",
      status: "ok",
      metadata: { backupType },
    });

    let done = false;
    let last = await runOrganizationBackupJob(v.db, v.caller.companyId, backupId, v.caller.uid);
    let iterations = 0;
    while (!done && iterations < 120) {
      iterations += 1;
      if (last.done) {
        done = true;
        break;
      }
      last = await runOrganizationBackupJob(v.db, v.caller.companyId, backupId, v.caller.uid);
    }

    return NextResponse.json({
      ok: true,
      backupId,
      progress: last,
      message:
        last.status === "COMPLETED"
          ? "Záloha dokončena."
          : last.done
            ? "Záloha selhala."
            : "Záloha běží na pozadí — obnovte seznam za chvíli.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
