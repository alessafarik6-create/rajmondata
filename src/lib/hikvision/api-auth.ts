import type { NextRequest } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { verifyCompanyBearer, type VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { loadMergedCatalogFromFirestore } from "@/lib/platform-invoice-auto";
import { canAccessCompanyModule, type CompanyPlatformFields } from "@/lib/platform-access";
import {
  callerHasCameraPermission,
  type CameraPermissionFlag,
} from "@/lib/hikvision/camera-access";
import { loadEmployeeDocForCaller } from "@/lib/portal-permissions-server";
import { resolveEffectivePortalPermissions } from "@/lib/portal-permissions";

export function hikvisionTenantOk(caller: { companyId: string }, companyId: string): boolean {
  return Boolean(companyId?.trim()) && caller.companyId === companyId.trim();
}

async function loadCompanyPlatformFields(
  db: Firestore,
  companyId: string
): Promise<CompanyPlatformFields | null> {
  const snap = await db.collection("companies").doc(companyId).get();
  if (!snap.exists) return null;
  return snap.data() as CompanyPlatformFields;
}

export type CameraApiAuthOk = {
  ok: true;
  db: Firestore;
  caller: VerifiedCompanyCaller;
  company: CompanyPlatformFields;
  employeeDoc: Record<string, unknown> | null;
};

export type CameraApiAuthFail = { ok: false; status: number; error: string };

async function requireCameraApiAccess(
  request: NextRequest | Request,
  permission: CameraPermissionFlag
): Promise<CameraApiAuthOk | CameraApiAuthFail> {
  const base = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!base.ok) {
    return { ok: false, status: base.status, error: base.error };
  }

  const { db, caller } = base;
  const company = await loadCompanyPlatformFields(db, caller.companyId);
  if (!company) {
    return { ok: false, status: 404, error: "Organizace neexistuje." };
  }

  const catalog = await loadMergedCatalogFromFirestore(db);
  if (!canAccessCompanyModule(company, "cameras", catalog)) {
    return {
      ok: false,
      status: 403,
      error: "Modul Kamery není pro organizaci aktivní nebo je globálně vypnutý.",
    };
  }

  const employeeDoc = await loadEmployeeDocForCaller(db, caller);
  const portalPerms = resolveEffectivePortalPermissions({
    role: caller.role,
    globalRoles: caller.globalRoles,
    employeeDoc,
  });
  const portalCamerasLevel = portalPerms.cameras ?? "none";

  if (
    !callerHasCameraPermission(caller, employeeDoc, permission, portalCamerasLevel)
  ) {
    return {
      ok: false,
      status: 403,
      error: "K modulu Kamery nemáte oprávnění.",
    };
  }

  return { ok: true, db, caller, company, employeeDoc };
}

export async function requireCamerasView(request: NextRequest | Request) {
  return requireCameraApiAccess(request, "view");
}

/** @deprecated Prefer requireCamerasView */
export async function requireCamerasRead(request: NextRequest | Request) {
  return requireCamerasView(request);
}

export async function requireCamerasLive(request: NextRequest | Request) {
  return requireCameraApiAccess(request, "live");
}

export async function requireCamerasPlayback(request: NextRequest | Request) {
  return requireCameraApiAccess(request, "playback");
}

export async function requireCamerasControl(request: NextRequest | Request) {
  return requireCameraApiAccess(request, "control");
}

export async function requireCamerasAdmin(request: NextRequest | Request) {
  return requireCameraApiAccess(request, "admin");
}

/** @deprecated Prefer requireCamerasAdmin */
export async function requireCamerasWrite(request: NextRequest | Request) {
  return requireCamerasAdmin(request);
}

export async function requireHikvisionIntegrationAdmin(request: NextRequest | Request) {
  return requireCamerasAdmin(request);
}
