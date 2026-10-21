import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { clientIpFromHeaders, hashIp } from "@/lib/security/ip-hash";
import { isBotUserAgent } from "@/lib/analytics/public-paths";
import { answerProductTourChat, type ProductTourChatMessage } from "@/lib/product-tour/chat-service";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(request: NextRequest) {
  const ua = request.headers.get("user-agent") || "";
  if (isBotUserAgent(ua)) return NextResponse.json({ ok: true, bot: true });

  const db = getAdminFirestore();
  const ipHash = hashIp(clientIpFromHeaders(request.headers));
  if (db) {
    const rl = await checkFirestoreRateLimit(db, `product_tour_chat:${ipHash}`, {
      limit: 20,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
  }

  let body: {
    question?: string;
    history?: ProductTourChatMessage[];
    companyType?: string;
    tourMode?: string;
    visitorId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const result = await answerProductTourChat({
    question: String(body.question ?? ""),
    history: Array.isArray(body.history) ? body.history : [],
    companyType: body.companyType ?? null,
    tourMode: body.tourMode ?? null,
  });

  if (db) {
    const day = new Date().toISOString().slice(0, 10);
    await db
      .collection("platform_product_tour_daily")
      .doc(day)
      .set(
        {
          day,
          counts: { demo_chat_message: FieldValue.increment(1) },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }

  return NextResponse.json({ ok: true, ...result });
}
