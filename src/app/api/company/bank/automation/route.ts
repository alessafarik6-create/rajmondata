import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireBankIntegrationAdmin, requireBankRead, bankTenantOk } from "@/lib/bank/api-auth";
import { bankConnectionsCol } from "@/lib/bank/collections";
import { loadBankConnection } from "@/lib/bank/connection-store";
import {
  bankAutomationPublicView,
  parseBankAutomationSettings,
} from "@/lib/bank/automation-settings";
import { bankAutomationLogsCol } from "@/lib/bank/automation-log";
import { writeBankAuditLog } from "@/lib/bank/audit";
import type { BankAutomationSettings } from "@/lib/bank/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const perm = await requireBankRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const organizationId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const conn = await loadBankConnection(perm.db, organizationId);
  const automation = bankAutomationPublicView(conn);

  const logsSnap = await bankAutomationLogsCol(perm.db, organizationId)
    .orderBy("createdAt", "desc")
    .limit(25)
    .get()
    .catch(() => null);

  const toIso = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof v === "string") return v;
    if (typeof (v as { toDate?: () => Date }).toDate === "function") {
      return (v as { toDate: () => Date }).toDate().toISOString();
    }
    return null;
  };

  const logs = (logsSnap?.docs ?? []).map((d) => {
    const row = d.data();
    return {
      id: d.id,
      kind: row.kind,
      success: row.success,
      message: row.message ?? null,
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
    };
  });

  return NextResponse.json({ ok: true, automation, logs });
}

type PatchBody = {
  companyId?: string;
  settings?: Partial<BankAutomationSettings>;
};

export async function PATCH(request: NextRequest) {
  const perm = await requireBankIntegrationAdmin(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }

  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const conn = await loadBankConnection(perm.db, organizationId);
  const merged = parseBankAutomationSettings({
    ...parseBankAutomationSettings(conn?.automation ?? null),
    ...(body.settings ?? {}),
  });

  await bankConnectionsCol(perm.db, organizationId).doc(conn?.id ?? "raiffeisen").set(
    {
      automation: merged,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await writeBankAuditLog(perm.db, {
    organizationId,
    userId: perm.caller.uid,
    action: "BANK_AUTOMATION_SETTINGS_UPDATED",
    metadata: { settings: merged },
  });

  const updated = await loadBankConnection(perm.db, organizationId);
  return NextResponse.json({
    ok: true,
    automation: bankAutomationPublicView(updated),
  });
}
