import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { buildSecretaryContext } from "@/lib/ai/secretary/context";
import {
  assertOpenAiVoiceConfigured,
  createOpenAiRealtimeSession,
  voiceErrorPayloadForClient,
} from "@/lib/ai/secretary/realtime-session";
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

  const configured = assertOpenAiVoiceConfigured();
  if (!configured.ok) {
    return NextResponse.json(
      voiceErrorPayloadForClient({
        message: configured.reason,
        code: "openai_not_configured",
      }),
      { status: 503 }
    );
  }

  try {
    console.info("[VOICE] session request", { userId: caller.uid, companyId });
    const ctx = await buildSecretaryContext(db, caller, companyId);
    const session = await createOpenAiRealtimeSession(ctx);
    await logSecretaryAudit(db, {
      companyId,
      userId: caller.uid,
      action: "ai_voice_session_started",
    });
    return NextResponse.json({
      ok: true,
      model: session.model,
      unified: true,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Realtime session selhala.";
    console.error("[VOICE] error", raw);
    return NextResponse.json(
      voiceErrorPayloadForClient({
        message: raw,
        code: "session_preflight_failed",
      }),
      { status: 502 }
    );
  }
}
