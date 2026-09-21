import type { NextRequest } from "next/server";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import {
  callerCanManageOrgEmailSettings,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export function hikvisionTenantOk(caller: { companyId: string }, companyId: string): boolean {
  return Boolean(companyId?.trim()) && caller.companyId === companyId.trim();
}

export async function requireCamerasRead(request: NextRequest | Request) {
  return verifyCompanyPortalMutation(request, "cameras");
}

export async function requireCamerasWrite(request: NextRequest | Request) {
  return verifyCompanyPortalMutation(request, "cameras");
}

export async function requireHikvisionIntegrationAdmin(request: NextRequest | Request) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return { ok: false as const, status: 503, error: "Server není nakonfigurován." };
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) return { ok: false as const, status: 401, error: "Neplatné přihlášení." };
  if (!callerCanManageOrgEmailSettings(caller)) {
    return { ok: false as const, status: 403, error: "Pouze administrátor organizace." };
  }
  return { ok: true as const, db, caller };
}
