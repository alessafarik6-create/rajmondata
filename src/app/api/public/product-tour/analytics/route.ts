import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { clientIpFromHeaders, hashIp } from "@/lib/security/ip-hash";
import { isBotUserAgent } from "@/lib/analytics/public-paths";

const DEMO_EVENTS = new Set([
  "demo_opened",
  "demo_started",
  "demo_quick_started",
  "demo_detailed_started",
  "demo_complete_started",
  "demo_step_viewed",
  "demo_completed",
  "demo_skipped",
  "demo_chapter_skipped",
  "demo_cta_clicked",
  "demo_interest_selected",
  "demo_ask",
  "demo_voice_on",
  "demo_voice_off",
  "demo_voice_error",
  "demo_chat_message",
  "demo_voice_input",
  "demo_company_type",
  "demo_resume_tour",
]);

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: true, skipped: true });

  const ua = request.headers.get("user-agent") || "";
  if (isBotUserAgent(ua)) return NextResponse.json({ ok: true, bot: true });

  const ipHash = hashIp(clientIpFromHeaders(request.headers));
  const rl = await checkFirestoreRateLimit(db, `product_tour:${ipHash}`, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const event = String(body.event ?? "").trim();
  if (!DEMO_EVENTS.has(event)) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }
  const visitorId = String(body.visitorId ?? "").trim().slice(0, 64);
  if (visitorId.length < 8) {
    return NextResponse.json({ error: "invalid_visitor" }, { status: 400 });
  }

  const day = new Date().toISOString().slice(0, 10);
  await db
    .collection("platform_product_tour_daily")
    .doc(day)
    .set(
      {
        day,
        counts: { [event]: FieldValue.increment(1) },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  await db.collection("platform_product_tour_events").add({
    event,
    visitorIdHash: ipHash.slice(0, 16),
    stepId: String(body.stepId ?? "").slice(0, 80) || null,
    errorCode: String(body.errorCode ?? "").slice(0, 80) || null,
    engine: String(body.engine ?? "").slice(0, 20) || null,
    interest: String(body.interest ?? "").slice(0, 40) || null,
    mode: String(body.mode ?? "").slice(0, 20) || null,
    path: String(body.path ?? "/prohlidka").slice(0, 200),
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true });
}
