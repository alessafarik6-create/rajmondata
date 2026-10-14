import type { NextRequest } from "next/server";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import {
  callerCanManageOrgEmailSettings,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { loadEmployeeDocForCaller } from "@/lib/portal-permissions-server";
import { callerCanManageEmailMailboxes } from "@/lib/email-mailbox/mailbox-manage-auth";

export async function requireEmailMailboxRead(request: NextRequest | Request) {
  return verifyCompanyPortalMutation(request, "emails");
}

export async function requireEmailMailboxWrite(request: NextRequest | Request) {
  return verifyCompanyPortalMutation(request, "emails");
}

/** Připojení, odpojení a úprava schránek — modul E-mail (náhled stačí) + oprávnění ke správě. */
export async function requireEmailMailboxAccountManage(request: NextRequest | Request) {
  const authHeader = request.headers.get("authorization");
  const read = await verifyCompanyBearerWithPortalAccess(authHeader, {
    moduleId: "emails",
    method: "GET",
  });
  if (!read.ok) return read;

  const employeeDoc = await loadEmployeeDocForCaller(read.db, read.caller);
  if (!callerCanManageEmailMailboxes(read.caller, employeeDoc)) {
    return {
      ok: false as const,
      status: 403,
      error: "Nemáte oprávnění spravovat e-mailové schránky.",
    };
  }
  return read;
}

/** Tenant isolation — pouze vlastní organizace. */
export function emailMailboxTenantOk(caller: { companyId: string }, companyId: string): boolean {
  return Boolean(companyId?.trim()) && caller.companyId === companyId.trim();
}

export async function requireOrgEmailAdmin(request: NextRequest | Request) {
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
