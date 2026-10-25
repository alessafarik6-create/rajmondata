import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { callerCanUseDocumentAi } from "@/lib/ai/permissions";
import {
  callerCanAccessChatMessage,
  findChatAttachment,
  loadChatMessageForAccess,
} from "@/lib/chat-attachment-access-server";
import { analyzeChatWorkIntent } from "@/lib/chat/chat-work-intent-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const v = await verifyCompanyBearerWithPortalAccess(
      request.headers.get("authorization"),
      { moduleId: "chat", method: "POST" }
    );
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    }
    const { caller, db } = v;
    const companyId = caller.companyId;

    if (
      !callerCanUseDocumentAi({
        uid: caller.uid,
        companyId,
        role: caller.role,
        globalRoles: caller.globalRoles,
        isSuperAdmin: caller.globalRoles.includes("super_admin"),
      })
    ) {
      return NextResponse.json(
        { ok: false, error: "Nemáte oprávnění k AI analýze v chatu." },
        { status: 403 }
      );
    }

    let body: {
      messageId?: string;
      attachmentIds?: string[];
      force?: boolean;
      timeZone?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
    }

    const messageId = String(body.messageId ?? "").trim();
    if (!messageId) {
      return NextResponse.json({ ok: false, error: "Chybí messageId." }, { status: 400 });
    }

    const loaded = await loadChatMessageForAccess(db, companyId, messageId);
    if (!loaded.ok) {
      return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });
    }
    if (
      !callerCanAccessChatMessage(
        { uid: caller.uid, role: caller.role, companyId },
        loaded.data
      )
    ) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.map((x) => String(x).trim()).filter(Boolean)
      : loaded.attachments.map((a) => a.id);

    for (const aid of attachmentIds) {
      if (!findChatAttachment(loaded.attachments, aid)) {
        return NextResponse.json({ ok: false, error: "Příloha nenalezena." }, { status: 404 });
      }
    }

    const messageText = String(loaded.data.text ?? "");
    const createdAtMs =
      typeof loaded.data.createdAtMs === "number"
        ? loaded.data.createdAtMs
        : null;

    const outcome = await analyzeChatWorkIntent({
      db,
      companyId,
      messageId,
      conversationId: String(loaded.data.conversationId ?? "company"),
      messageText,
      messageCreatedAtMs: createdAtMs,
      attachments: loaded.attachments,
      attachmentIds,
      createdByUid: caller.uid,
      timeZone: body.timeZone ?? "Europe/Prague",
    });

    if (!outcome.ok) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status });
    }

    const analysisId = outcome.analysis.id;
    const msgRef = db.collection("companies").doc(companyId).collection("chat").doc(messageId);
    const nextAttachments = loaded.attachments.map((a) =>
      attachmentIds.includes(a.id)
        ? {
            ...a,
            aiWorkIntentAnalysisId: analysisId,
            workIntentStatus: outcome.analysis.readable ? "ready" : "error",
          }
        : a
    );
    await msgRef.update({
      aiWorkIntentAnalysisId: analysisId,
      workIntentStatus: outcome.analysis.readable ? "ready" : "error",
      attachments: nextAttachments,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      cached: outcome.cached,
      analysis: outcome.analysis,
    });
  } catch (err) {
    console.error("[chat/analyze-work-intent]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Analýza se nezdařila." }, { status: 500 });
  }
}
