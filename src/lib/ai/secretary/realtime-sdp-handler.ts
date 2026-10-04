import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { getOpenAiApiKey } from "@/lib/ai/config";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { buildSecretaryContext } from "@/lib/ai/secretary/context";
import {
  assertOpenAiVoiceConfigured,
  buildUnifiedRealtimeSessionJson,
  mapRealtimeSessionErrorForClient,
} from "@/lib/ai/secretary/realtime-session";
import { openAiRealtimeCallsExchange } from "@/lib/ai/openai-realtime-fetch";

const LOG = "[VOICE]";

async function readSdpOffer(request: NextRequest): Promise<string> {
  const ct = (request.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/sdp") || ct.startsWith("text/plain")) {
    return (await request.text()).trim();
  }
  try {
    const body = (await request.json()) as { sdp?: string };
    return String(body.sdp ?? "").trim();
  } catch {
    return "";
  }
}

function voiceErrorJson(
  status: number,
  code: string,
  userMessage: string,
  extra?: {
    upstreamStatus?: number;
    upstreamMessage?: string;
  }
): NextResponse {
  const isDev = process.env.NODE_ENV === "development";
  const payload: Record<string, unknown> = {
    error: code === "openai_sdp_exchange_failed" ? "openai_realtime_failed" : code,
    code,
    message: userMessage,
  };
  if (isDev && extra?.upstreamStatus != null) {
    payload.upstreamStatus = extra.upstreamStatus;
    payload.upstreamMessage = extra.upstreamMessage?.slice(0, 500) ?? null;
  }
  return NextResponse.json(payload, { status });
}

export async function handleSecretaryRealtimeSdpPost(
  request: NextRequest,
  db: Firestore,
  auth: Auth
): Promise<Response> {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) {
    return NextResponse.json({ error: "unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const companyId = String(
    request.nextUrl.searchParams.get("companyId") ?? caller.companyId
  ).trim();
  if (companyId !== caller.companyId) {
    return NextResponse.json({ error: "forbidden", code: "forbidden" }, { status: 403 });
  }

  const apiKeyPresent = Boolean(getOpenAiApiKey());
  console.info(LOG, "OPENAI_API_KEY configured:", apiKeyPresent);
  if (!apiKeyPresent) {
    console.error(LOG, "OPENAI_API_KEY missing");
    return voiceErrorJson(
      500,
      "openai_api_key_missing",
      "Hlasová AI není na serveru nakonfigurována."
    );
  }

  const configured = assertOpenAiVoiceConfigured();
  if (!configured.ok) {
    return voiceErrorJson(500, "openai_api_key_missing", configured.reason);
  }

  const sdp = await readSdpOffer(request);
  if (!sdp || !sdp.startsWith("v=")) {
    return NextResponse.json(
      { error: "invalid_sdp", code: "invalid_sdp", message: "Chybí platná SDP offer." },
      { status: 400 }
    );
  }

  const apiKey = getOpenAiApiKey()!;

  try {
    const ctx = await buildSecretaryContext(db, caller, companyId);
    const sessionJson = buildUnifiedRealtimeSessionJson(ctx);
    const safetyId = createHash("sha256")
      .update(`${caller.uid}:${companyId}`)
      .digest("hex")
      .slice(0, 64);

    console.info(LOG, "peer connection SDP exchange", {
      userId: caller.uid,
      companyId,
      model: configured.model,
      endpoint: "/v1/realtime/calls",
    });

    const result = await openAiRealtimeCallsExchange({
      apiKey,
      sdpOffer: sdp,
      sessionJson,
      model: configured.model,
      safetyIdentifier: safetyId,
    });

    if (!result.ok) {
      const userMsg = mapRealtimeSessionErrorForClient(result.info.message, "openai_sdp_exchange_failed");
      return voiceErrorJson(502, "openai_sdp_exchange_failed", userMsg, {
        upstreamStatus: result.info.httpStatus,
        upstreamMessage: result.info.message,
      });
    }

    return new Response(result.answerSdp, {
      status: 200,
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error(LOG, "error", raw);
    return voiceErrorJson(
      502,
      "voice_internal_error",
      mapRealtimeSessionErrorForClient(raw, "voice_internal_error")
    );
  }
}
