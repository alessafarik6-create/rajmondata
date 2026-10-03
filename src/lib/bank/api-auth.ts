import type { NextRequest } from "next/server";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import {
  callerCanManageOrgEmailSettings,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export async function requireBankRead(request: NextRequest | Request) {
  return verifyCompanyPortalMutation(request, "bank");
}

export async function requireBankWrite(request: NextRequest | Request) {
  return verifyCompanyPortalMutation(request, "bank");
}

export function bankTenantOk(caller: { companyId: string }, organizationId: string): boolean {
  return Boolean(organizationId?.trim()) && caller.companyId === organizationId.trim();
}

/** Nastavení certifikátu / ClientID — owner nebo admin (bank.manageIntegration). */
export async function requireBankIntegrationAdmin(request: NextRequest | Request) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return { ok: false as const, status: 503, error: "Server není nakonfigurován." };
  }
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) return { ok: false as const, status: 401, error: "Neplatné přihlášení." };
  const read = await verifyCompanyPortalMutation(request, "bank");
  if (!read.ok) return { ok: false as const, status: read.status, error: read.error };
  if (!callerCanManageOrgEmailSettings(caller)) {
    return { ok: false as const, status: 403, error: "Integraci banky smí spravovat pouze administrátor." };
  }
  return { ok: true as const, db, caller: read.caller };
}
