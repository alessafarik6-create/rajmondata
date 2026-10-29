import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { respondToJobAssignmentInvite } from "@/lib/chat/chat-work-intent-assignment-response-server";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const v = await verifyCompanyBearerWithPortalAccess(
      request.headers.get("authorization"),
      { moduleId: "jobs", method: "POST" }
    );
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    }
    const { caller, db } = v;
    const companyId = caller.companyId;

    let body: {
      messageId?: string;
      action?: "accept" | "decline";
      declineReason?: string | null;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
    }

    const messageId = String(body.messageId ?? "").trim();
    const action = body.action;
    if (!messageId || (action !== "accept" && action !== "decline")) {
      return NextResponse.json({ ok: false, error: "Chybí parametry." }, { status: 400 });
    }

    const userSnap = await db.collection("users").doc(caller.uid).get();
    const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
    const callerName =
      String(userData.displayName ?? userData.name ?? "").trim() ||
      String(userData.email ?? "Zaměstnanec");

    const outcome = await respondToJobAssignmentInvite({
      db,
      companyId,
      callerUid: caller.uid,
      callerName,
      messageId,
      action,
      declineReason: body.declineReason,
    });

    if (!outcome.ok) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, status: outcome.status });
  } catch (err) {
    console.error("[chat/job-assignment-response]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Akce se nezdařila." }, { status: 500 });
  }
}
