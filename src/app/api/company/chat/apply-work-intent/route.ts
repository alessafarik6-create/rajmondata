import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { callerCanUseDocumentAi } from "@/lib/ai/permissions";
import {
  callerCanAccessChatMessage,
  loadChatMessageForAccess,
} from "@/lib/chat-attachment-access-server";
import { applyChatWorkIntentProposals } from "@/lib/chat/chat-work-intent-apply-server";
import type { ChatWorkIntentProposal } from "@/lib/chat/chat-work-intent-types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

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

    if (
      !callerCanUseDocumentAi({
        uid: caller.uid,
        companyId,
        role: caller.role,
        globalRoles: caller.globalRoles,
        isSuperAdmin: caller.globalRoles.includes("super_admin"),
      })
    ) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }

    let body: {
      messageId?: string;
      analysisId?: string;
      idempotencyKey?: string;
      selectedProposalIds?: string[];
      proposals?: ChatWorkIntentProposal[];
      createMissingCustomers?: boolean;
      linkJobIdByProposal?: Record<string, string>;
      timeZone?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
    }

    const messageId = String(body.messageId ?? "").trim();
    const analysisId = String(body.analysisId ?? "").trim();
    const idempotencyKey = String(body.idempotencyKey ?? "").trim();
    if (!messageId || !analysisId || !idempotencyKey) {
      return NextResponse.json({ ok: false, error: "Chybí identifikátory." }, { status: 400 });
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

    const analysisSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("chatWorkIntentAnalyses")
      .doc(analysisId)
      .get();
    if (!analysisSnap.exists) {
      return NextResponse.json({ ok: false, error: "Analýza nenalezena." }, { status: 404 });
    }

    const stored = analysisSnap.data() as { proposals?: ChatWorkIntentProposal[] };
    const proposals =
      Array.isArray(body.proposals) && body.proposals.length
        ? body.proposals
        : stored.proposals ?? [];

    const selected = Array.isArray(body.selectedProposalIds)
      ? body.selectedProposalIds.map((x) => String(x))
      : [];
    if (!selected.length) {
      return NextResponse.json({ ok: false, error: "Vyberte alespoň jeden návrh." }, { status: 400 });
    }

    const userSnap = await db.collection("users").doc(caller.uid).get();
    const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
    const callerName =
      String(userData.displayName ?? userData.name ?? "").trim() ||
      String(userData.email ?? "Uživatel");

    const { results, duplicate } = await applyChatWorkIntentProposals({
      db,
      companyId,
      callerUid: caller.uid,
      callerName,
      callerRole: caller.role,
      timeZone: body.timeZone ?? "Europe/Prague",
      idempotencyKey,
      analysisId,
      proposals,
      selectedProposalIds: selected,
      options: {
        createMissingCustomers: body.createMissingCustomers !== false,
        linkJobIdByProposal: body.linkJobIdByProposal,
      },
    });

    return NextResponse.json({ ok: true, duplicate, results });
  } catch (err) {
    console.error("[chat/apply-work-intent]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Uložení se nezdařilo." }, { status: 500 });
  }
}
