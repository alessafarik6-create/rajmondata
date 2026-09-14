import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanManageAiCenter } from "@/lib/ai/permissions";
import { parseKnowledgeQueryIntent } from "@/lib/ai/knowledge-query-intent";
import { answerKnowledgeQuestion } from "@/lib/ai/knowledge-answer-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  companyId?: string;
  question?: string;
  debug?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
    }

    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
    }
    if (!callerCanManageAiCenter(caller)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }

    const body = (await request.json()) as Body;
    const companyId = String(body.companyId ?? caller.companyId ?? "").trim();
    const question = String(body.question ?? "").trim();

    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }
    if (!question) {
      return NextResponse.json({ ok: false, error: "Zadejte otázku." }, { status: 400 });
    }

    const intent = parseKnowledgeQueryIntent(question);
    const result = await answerKnowledgeQuestion(db, companyId, question, intent, {
      debug: body.debug !== false,
      generateAnswer: true,
    });

    return NextResponse.json({
      ok: true,
      intent,
      result: {
        found: result.found,
        answerText: result.answerText,
        sources: result.sources,
        relatedSources: result.relatedSources,
        needsVisualContext: result.needsVisualContext,
        primarySource: result.primarySource,
      },
      debug: result.debug ?? null,
    });
  } catch (err) {
    console.error("[ai/knowledge/ask]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Dotaz selhal." },
      { status: 500 }
    );
  }
}
