import type { NextRequest } from "next/server";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import {
  callerCanManageOrgEmailSettings,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export async function requireEmailMailboxRead(request: NextRequest | Request) {
  return verifyCompanyPortalMutation(request, "emails");
}

export async function requireEmailMailboxWrite(request: NextRequest | Request) {
  return verifyCompanyPortalMutation(request, "emails");
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
