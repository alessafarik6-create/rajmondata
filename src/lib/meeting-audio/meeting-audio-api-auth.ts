import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { assertCallerCanMeetingRecordsStaffActions } from "@/lib/meeting-records-api-auth";

export async function requireMeetingAudioAccess(request: NextRequest, companyId: string) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return { ok: false as const, status: 503, error: "Server není nakonfigurován." };
  }
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) return { ok: false as const, status: 401, error: "Neplatné přihlášení." };
  const gate = await assertCallerCanMeetingRecordsStaffActions(db, caller, companyId);
  if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
  return { ok: true as const, db, caller };
}
