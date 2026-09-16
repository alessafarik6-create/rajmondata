import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { answerPortalAssistantQuestion } from "@/lib/portal-assistant-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

type Body = {
  question?: string;
  pathname?: string;
};

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = (await request.json()) as Body;
    const question = String(body.question ?? "").trim();
    const pathname = String(body.pathname ?? "/portal/dashboard").trim();

    if (!question) {
      return NextResponse.json({ ok: false, error: "Zadejte otázku." }, { status: 400 });
    }

    const reply = await answerPortalAssistantQuestion({
      db: auth.db,
      caller: auth.caller,
      question,
      pathname,
    });

    return NextResponse.json({ ok: true, reply });
  } catch (err) {
    console.error("[portal-assistant/ask]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Odpověď se nepodařilo načíst." },
      { status: 500 }
    );
  }
}
