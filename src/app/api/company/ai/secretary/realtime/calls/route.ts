import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { OPENAI_REALTIME_CALLS_URL } from "@/lib/ai/openai-realtime-api";
import { mapRealtimeSessionErrorForClient } from "@/lib/ai/secretary/realtime-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  sdp?: string;
  ephemeralKey?: string;
};

/**
 * Proxy SDP výměny — browser posílá pouze RAJMONDATA, ne OpenAI URL.
 */
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

  const sdp = String(body.sdp ?? "").trim();
  const ephemeralKey = String(body.ephemeralKey ?? "").trim();
  if (!sdp || !ephemeralKey) {
    return NextResponse.json({ ok: false, error: "Chybí SDP nebo session token." }, { status: 400 });
  }

  try {
    const url = OPENAI_REALTIME_CALLS_URL();
    console.info("[VOICE] peer connection SDP exchange", { endpoint: "realtime/calls" });

    const sdpRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
      body: sdp,
    });

    const answerSdp = await sdpRes.text();
    if (!sdpRes.ok) {
      console.error(
        "[VOICE] SDP exchange failed",
        `HTTP ${sdpRes.status}`,
        answerSdp.slice(0, 300)
      );
      return NextResponse.json(
        {
          ok: false,
          error: mapRealtimeSessionErrorForClient(answerSdp),
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, sdp: answerSdp });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[VOICE] error", raw);
    return NextResponse.json(
      { ok: false, error: mapRealtimeSessionErrorForClient(raw) },
      { status: 502 }
    );
  }
}
