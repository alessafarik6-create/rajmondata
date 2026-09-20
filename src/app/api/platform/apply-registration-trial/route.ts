import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { applyRegistrationTrialIfEligible } from "@/lib/platform-trial-service";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  }

  let uid: string;
  try {
    uid = (await auth.verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  const companyId = String(body.companyId ?? "").trim();
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const result = await applyRegistrationTrialIfEligible(db, companyId, uid);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
