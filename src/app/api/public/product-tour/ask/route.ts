import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { clientIpFromHeaders, hashIp } from "@/lib/security/ip-hash";
import { answerAiTutorQuestion } from "@/lib/ai-tutor/tutor-ask-service";
import { isBotUserAgent } from "@/lib/analytics/public-paths";

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({
      ok: true,
      answer: "RAJMONDATA spojuje zakázky, tým, finance a AI. Pro detailní odpovědi si založte zkušební firmu zdarma.",
    });
  }

  const ua = request.headers.get("user-agent") || "";
  if (isBotUserAgent(ua)) return NextResponse.json({ ok: true, bot: true });

  const ipHash = hashIp(clientIpFromHeaders(request.headers));
  const rl = await checkFirestoreRateLimit(db, `product_tour_ask:${ipHash}`, { limit: 15, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "Příliš mnoho dotazů." }, { status: 429 });
  }

  let body: { question?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const result = answerAiTutorQuestion({
    question: String(body.question ?? ""),
    pathname: "/prohlidka",
  });

  return NextResponse.json({ ok: true, ...result });
}
