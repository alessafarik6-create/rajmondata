import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { ensureCompanyLicenseDoc, writeCompanyLicenseAndDenorm } from "@/lib/company-license-admin";
import { emptyModuleEntitlement } from "@/lib/company-license-record";
import { PLATFORM_MODULE_CODES, type PlatformModuleCode } from "@/lib/platform-config";
import { PLATFORM_MODULES_COLLECTION, PLATFORM_SECURITY_AUDIT_COLLECTION } from "@/lib/firestore-collections";
import { buildMergedPlatformCatalogMap } from "@/lib/platform-module-catalog";
import { listModuleUserAssignmentIds } from "@/lib/platform-module-assignments.server";
import { suspendModuleForOrganization } from "@/lib/platform-module-assignments.server";
import { effectiveModulePriceCzk } from "@/lib/rajmondata-editor/module-access";
import { isModuleEntitlementActiveNow } from "@/lib/platform-config";
import { syncRajmondataEditorAccessWithRetry } from "@/lib/rajmondata-editor/editor-access-sync.server";

export const dynamic = "force-dynamic";

function isCode(v: string): v is PlatformModuleCode {
  return (PLATFORM_MODULE_CODES as readonly string[]).includes(v);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const { id } = await params;

  const modSnap = await db.collection(PLATFORM_MODULES_COLLECTION).get();
  const catalog = buildMergedPlatformCatalogMap(
    modSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
  );
  const license = await ensureCompanyLicenseDoc(db, id);

  const rows = [];
  for (const code of PLATFORM_MODULE_CODES) {
    const row = catalog[code];
    if (!row?.activeGlobally && row?.moduleKind !== "external") continue;
    const ent = license.modules[code] ?? emptyModuleEntitlement(code);
    const assigned = await listModuleUserAssignmentIds(db, id, code);
    rows.push({
      code,
      name: row.name,
      moduleKind: row.moduleKind,
      active: isModuleEntitlementActiveNow(ent),
      entitlement: ent,
      priceMonthlyCzk: effectiveModulePriceCzk(ent, row, "monthly"),
      assignedUsers: assigned.length,
      seatCount: ent.seatCount ?? row.defaultSeatCount ?? 1,
    });
  }
  return NextResponse.json({ ok: true, modules: rows, license });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const { id } = await params;
  const body = (await request.json()) as {
    moduleCode?: string;
    action?: "activate_free" | "activate_paid" | "trial" | "extend" | "suspend" | "remove";
    customPriceCzk?: number | null;
    expiresAt?: string | null;
    seatCount?: number;
    days?: number;
  };

  const code = String(body.moduleCode ?? "").trim();
  if (!isCode(code)) return NextResponse.json({ error: "Neplatný modul." }, { status: 400 });
  const action = body.action ?? "activate_free";

  let license = await ensureCompanyLicenseDoc(db, id);
  const prev = license.modules[code] ?? emptyModuleEntitlement(code);
  const now = new Date().toISOString();
  let next = { ...prev, moduleCode: code };

  if (action === "remove" || action === "suspend") {
    next = {
      ...next,
      active: false,
      tenantModuleStatus: "suspended",
      paymentStatus: "suspended",
    };
    await suspendModuleForOrganization({
      db,
      organizationId: id,
      moduleCode: code,
      actor: session.username,
      reason: action,
    });
  } else if (action === "trial") {
    const modSnap = await db.collection(PLATFORM_MODULES_COLLECTION).doc(code).get();
    const row = buildMergedPlatformCatalogMap(
      modSnap.exists ? [{ id: modSnap.id, ...(modSnap.data() as Record<string, unknown>) }] : []
    )[code];
    const days = body.days ?? row.trialDays ?? 14;
    const exp = new Date(Date.now() + days * 86400000).toISOString();
    next = {
      ...next,
      active: true,
      isTrial: true,
      paymentStatus: "trial",
      activatedAt: now,
      expiresAt: exp,
      tenantModuleStatus: "active",
    };
  } else if (action === "extend") {
    const base = body.expiresAt ?? new Date(Date.now() + 30 * 86400000).toISOString();
    next = { ...next, active: true, expiresAt: base, tenantModuleStatus: "active" };
  } else if (action === "activate_paid") {
    next = {
      ...next,
      active: true,
      isTrial: false,
      paymentStatus: "paid",
      activatedAt: now,
      expiresAt: body.expiresAt ?? null,
      customPriceCzk: body.customPriceCzk ?? prev.customPriceCzk,
      tenantModuleStatus: "active",
    };
  } else {
    next = {
      ...next,
      active: true,
      isTrial: false,
      paymentStatus: "free",
      activatedAt: now,
      expiresAt: body.expiresAt ?? null,
      customPriceCzk: body.customPriceCzk ?? null,
      tenantModuleStatus: "active",
    };
  }

  if (body.seatCount != null) next = { ...next, seatCount: Math.max(1, Number(body.seatCount)) };

  license = {
    ...license,
    modules: { ...license.modules, [code]: next },
    enabledModules: next.active
      ? Array.from(new Set([...license.enabledModules.filter((c) => c !== code), code]))
      : license.enabledModules.filter((c) => c !== code),
  };

  if (code === "rajmondata_editor") {
    const moduleActive = isModuleEntitlementActiveNow(next) && action !== "remove" && action !== "suspend";
    const sync = await syncRajmondataEditorAccessWithRetry({
      db,
      organizationId: id,
      moduleActive,
      licenseActive: moduleActive && next.paymentStatus !== "suspended",
      actor: session.username,
    });
    license = {
      ...license,
      editorAccessSyncPending: !sync.ok,
      editorAccessSyncLastError: sync.ok ? null : sync.error,
    };
  }

  await writeCompanyLicenseAndDenorm(db, id, license, { organizationDenormPatch: {} });
  await db.collection(PLATFORM_SECURITY_AUDIT_COLLECTION).add({
    action: `module_license_${action}`,
    organizationId: id,
    moduleCode: code,
    actor: session.username,
    patch: next,
    at: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, entitlement: next });
}
