import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { clientIpFromHeaders, hashIp } from "@/lib/security/ip-hash";
import { isBotUserAgent } from "@/lib/analytics/public-paths";
import {
  PORTAL_ASSISTANT_MAX_AUDIO_BYTES,
  transcribeAudioWithOpenAiWhisper,
} from "@/lib/ai/openai-whisper-transcribe";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(request: NextRequest) {
  const ua = request.headers.get("user-agent") || "";
  if (isBotUserAgent(ua)) return NextResponse.json({ ok: true, bot: true });

  const db = getAdminFirestore();
  const ipHash = hashIp(clientIpFromHeaders(request.headers));
  if (db) {
    const rl = await checkFirestoreRateLimit(db, `product_tour_voice:${ipHash}`, {
      limit: 12,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
  }

  const form = await request.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "missing_audio" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > PORTAL_ASSISTANT_MAX_AUDIO_BYTES) {
    return NextResponse.json({ ok: false, error: "audio_too_large" }, { status: 400 });
  }

  try {
    const text = await transcribeAudioWithOpenAiWhisper({
      audio: buf,
      filename: "tour.webm",
      mimeType: file.type || "audio/webm",
      language: "cs",
    });
    if (db) {
      const day = new Date().toISOString().slice(0, 10);
      await db
        .collection("platform_product_tour_daily")
        .doc(day)
        .set(
          {
            day,
            counts: { demo_voice_input: FieldValue.increment(1) },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    }
    return NextResponse.json({ ok: true, text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "transcribe_failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
