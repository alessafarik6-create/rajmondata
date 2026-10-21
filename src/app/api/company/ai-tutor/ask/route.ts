import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { answerAiTutorQuestion } from "@/lib/ai-tutor/tutor-ask-service";
import { callerOrgMatch } from "@/lib/ai-tutor/access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"), { method: "POST" });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const rl = await checkFirestoreRateLimit(auth.db, `ai_tutor_ask:${auth.caller.uid}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "Příliš mnoho dotazů. Zkuste za chvíli." }, { status: 429 });
  }

  let body: { companyId?: string; question?: string; pathname?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!callerOrgMatch(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const result = answerAiTutorQuestion({
    question: String(body.question ?? ""),
    pathname: String(body.pathname ?? ""),
    role: auth.caller.role,
  });

  return NextResponse.json({ ok: true, ...result });
}
