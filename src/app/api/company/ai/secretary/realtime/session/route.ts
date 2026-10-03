import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { buildSecretaryContext } from "@/lib/ai/secretary/context";
import { createOpenAiRealtimeSession } from "@/lib/ai/secretary/realtime-session";
import { logSecretaryAudit } from "@/lib/ai/secretary/audit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
  }

  let body: { companyId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? caller.companyId).trim();
  if (companyId !== caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  try {
    const ctx = await buildSecretaryContext(db, caller, companyId);
    const session = await createOpenAiRealtimeSession(ctx);
    await logSecretaryAudit(db, {
      companyId,
      userId: caller.uid,
      action: "ai_voice_session_started",
    });
    return NextResponse.json({
      ok: true,
      clientSecret: session.clientSecret,
      expiresAt: session.expiresAt,
      model: session.model,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Realtime session selhala.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
