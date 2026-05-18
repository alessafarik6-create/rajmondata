import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import {
  saveInquiryOfferDraft,
  sendInquiryOfferEmail,
} from "@/lib/inquiry-offer-send-admin";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  companyId?: string;
  leadKey?: string;
  importLeadId?: string;
  action?: "send" | "draft";
  to?: string;
  subject?: string;
  bodyText?: string;
  priceGross?: number | null;
  internalNote?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  draftOfferId?: string | null;
};

function canSendInquiryOffers(role: string): boolean {
  return ["owner", "admin", "manager", "accountant"].includes(role);
}

export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json(
        { ok: false, error: "Server není nakonfigurován." },
        { status: 503 }
      );
    }

    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
    }
    const userSnap = await db.collection("users").doc(caller.uid).get();
    const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
    const sentByEmail = String(userData.email ?? "").trim() || null;
    const sentByName = String(userData.displayName ?? "").trim() || null;
    if (caller.role === "customer") {
      return NextResponse.json({ ok: false, error: "Zákazník nemá přístup." }, { status: 403 });
    }
    if (!canSendInquiryOffers(caller.role)) {
      return NextResponse.json(
        { ok: false, error: "Nemáte oprávnění odesílat nabídky." },
        { status: 403 }
      );
    }

    const body = (await request.json()) as Body;
    const companyId = String(body.companyId ?? "").trim();
    const leadKey = String(body.leadKey ?? "").trim();
    const importLeadId = String(body.importLeadId ?? leadKey).trim();
    const action = body.action === "draft" ? "draft" : "send";

    if (!companyId || !leadKey) {
      return NextResponse.json(
        { ok: false, error: "Chybí companyId nebo leadKey." },
        { status: 400 }
      );
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const to = String(body.to ?? "").trim();
    if (action === "send" && !to) {
      return NextResponse.json(
        { ok: false, error: "Příjemce (e-mail z poptávky) je povinný." },
        { status: 400 }
      );
    }

    const common = {
      companyId,
      leadKey,
      importLeadId,
      to,
      subject: String(body.subject ?? "").trim(),
      bodyText: String(body.bodyText ?? ""),
      priceGross: body.priceGross,
      internalNote: body.internalNote,
      templateId: body.templateId,
      templateName: body.templateName,
      userId: caller.uid,
      sentByEmail,
      sentByName,
      draftOfferId: body.draftOfferId,
    };

    if (action === "draft") {
      const draft = await saveInquiryOfferDraft(db, common);
      if (!draft.ok) {
        return NextResponse.json({ ok: false, error: draft.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, offerId: draft.offerId, status: "draft" });
    }

    const sent = await sendInquiryOfferEmail(db, common);
    if (!sent.ok) {
      return NextResponse.json(
        { ok: false, error: sent.error, detail: sent.detail },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      offerId: sent.offerId,
      messageId: sent.messageId,
      threadId: sent.threadId,
      status: "sent",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: errorMessageFromUnknown(err) },
      { status: 500 }
    );
  }
}
