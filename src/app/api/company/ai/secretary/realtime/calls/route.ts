import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { getOpenAiApiKey } from "@/lib/ai/config";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { buildSecretaryContext } from "@/lib/ai/secretary/context";
import {
  assertOpenAiVoiceConfigured,
  buildUnifiedRealtimeSessionJson,
  voiceErrorPayloadForClient,
} from "@/lib/ai/secretary/realtime-session";
import { openAiRealtimeCallsExchange } from "@/lib/ai/openai-realtime-fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  sdp?: string;
  companyId?: string;
};

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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? caller.companyId).trim();
  const sdp = String(body.sdp ?? "").trim();
  if (!sdp || !sdp.startsWith("v=")) {
    return NextResponse.json(
      { ok: false, error: "Chybí platná SDP offer.", code: "invalid_sdp" },
      { status: 400 }
    );
  }
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

  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    console.error("[VOICE] OPENAI_API_KEY missing");
    return NextResponse.json(
      voiceErrorPayloadForClient({
        message: "missing key",
        code: "openai_not_configured",
      }),
      { status: 503 }
    );
  }

  try {
    const ctx = await buildSecretaryContext(db, caller, companyId);
    const sessionJson = buildUnifiedRealtimeSessionJson(ctx);
    const safetyId = createHash("sha256")
      .update(`${caller.uid}:${companyId}`)
      .digest("hex")
      .slice(0, 64);

    console.info("[VOICE] peer connection SDP exchange", {
      userId: caller.uid,
      companyId,
      model: configured.model,
    });

    const result = await openAiRealtimeCallsExchange({
      apiKey,
      sdpOffer: sdp,
      sessionJson,
      model: configured.model,
      safetyIdentifier: safetyId,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ...voiceErrorPayloadForClient({
            message: result.info.message,
            code: "openai_sdp_exchange_failed",
            openAiStatus: result.info.httpStatus,
            openAiCode: result.info.errorCode,
          }),
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      sdp: result.answerSdp,
      model: configured.model,
      requestId: result.requestId,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[VOICE] error", raw);
    return NextResponse.json(
      voiceErrorPayloadForClient({
        message: raw,
        code: "voice_internal_error",
      }),
      { status: 502 }
    );
  }
}
