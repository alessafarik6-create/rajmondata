import { readFile } from "node:fs/promises";
import https from "node:https";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "edge-tts-node";
import { listProductTourAudioItems } from "@/lib/ai-tutor/product-demo-audio";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { clientIpFromHeaders, hashIp } from "@/lib/security/ip-hash";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { isBotUserAgent } from "@/lib/analytics/public-paths";

export const runtime = "nodejs";

const VOICE = "cs-CZ-VlastaNeural";
const HTTPS_AGENT = new https.Agent({ keepAlive: true });

const narrationById = () => {
  const map = new Map<string, string>();
  for (const item of listProductTourAudioItems()) map.set(item.id, item.narration);
  return map;
};

const NARRATIONS = narrationById();

/** Krátká cache v paměti procesu (serverless instance). */
const memoryCache = new Map<string, Buffer>();

function safeStepId(raw: string): string | null {
  const id = raw.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  if (!NARRATIONS.has(id)) return null;
  return id;
}

async function synthesizeMp3(text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS({ agent: HTTPS_AGENT });
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const audioStream = tts.toStream(text);
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ stepId: string }> }
) {
  const ua = request.headers.get("user-agent") || "";
  if (isBotUserAgent(ua)) {
    return NextResponse.json({ error: "bot" }, { status: 403 });
  }

  const { stepId: rawId } = await context.params;
  const stepId = safeStepId(rawId ?? "");
  if (!stepId) {
    return NextResponse.json({ error: "invalid_step" }, { status: 404 });
  }

  const db = getAdminFirestore();
  if (db) {
    const ipHash = hashIp(clientIpFromHeaders(request.headers));
    const rl = await checkFirestoreRateLimit(db, `tour_audio:${ipHash}`, {
      limit: 90,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
  }

  const staticPath = join(process.cwd(), "public", "product-tour", "audio", `${stepId}.mp3`);
  try {
    const file = await readFile(staticPath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    /* generate */
  }

  const cached = memoryCache.get(stepId);
  if (cached) {
    return new NextResponse(new Uint8Array(cached), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  const text = NARRATIONS.get(stepId)!;
  try {
    const buf = await synthesizeMp3(text);
    memoryCache.set(stepId, buf);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    console.warn("[product-tour/audio] synthesis failed", {
      stepId,
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "synthesis_failed" }, { status: 503 });
  }
}
