import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  PORTAL_ASSISTANT_MAX_AUDIO_BYTES,
  transcribeAudioWithOpenAiWhisper,
} from "@/lib/ai/openai-whisper-transcribe";
import { OpenAiClientError } from "@/lib/ai/openai-client";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const rateBucket = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_PER_MINUTE = 12;

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const key = uid;
  const row = rateBucket.get(key);
  if (!row || row.resetAt < now) {
    rateBucket.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (row.count >= RATE_LIMIT_PER_MINUTE) return false;
  row.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    if (!checkRateLimit(auth.caller.uid)) {
      return NextResponse.json(
        { ok: false, error: "Příliš mnoho hlasových dotazů. Zkuste to za chvíli." },
        { status: 429 }
      );
    }

    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Chybí audio." }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > PORTAL_ASSISTANT_MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Nahrávka překračuje povolenou délku (max cca 2 min)." },
        { status: 400 }
      );
    }

    const mimeType = file.type || "audio/webm";
    const filename =
      typeof (file as File).name === "string" && (file as File).name
        ? (file as File).name
        : "portal-assistant.webm";

    const text = await transcribeAudioWithOpenAiWhisper({
      audio: buf,
      filename,
      mimeType,
      language: "cs",
    });

    return NextResponse.json({ ok: true, text });
  } catch (e) {
    if (e instanceof OpenAiClientError) {
      return NextResponse.json({ ok: false, error: e.userMessage }, { status: e.statusCode });
    }
    console.error("[portal-assistant/transcribe]", errorMessageFromUnknown(e));
    return NextResponse.json({ ok: false, error: "Přepis se nepodařil." }, { status: 500 });
  }
}
