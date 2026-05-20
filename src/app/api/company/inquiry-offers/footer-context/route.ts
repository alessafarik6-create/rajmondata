import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { resolveInquiryOfferAuthor } from "@/lib/inquiry-offer-author-resolve";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { readInquiryEmailIdentity } from "@/lib/inquiry-offer-email";
import { buildInquiryOfferFooterData } from "@/lib/inquiry-offer-footer";
import {
  buildInquiryOfferSendPlan,
  INQUIRY_OFFER_SEND_METHOD_LABELS,
} from "@/lib/inquiry-offer-send-plan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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
    if (caller.role === "customer") {
      return NextResponse.json({ ok: false, error: "Zákazník nemá přístup." }, { status: 403 });
    }

    const companyId = String(request.nextUrl.searchParams.get("companyId") ?? "").trim();
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const snap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Organizace nenalezena." }, { status: 404 });
    }
    const company = (snap.data() ?? {}) as Record<string, unknown>;
    const identity = readInquiryEmailIdentity(company);
    const author = await resolveInquiryOfferAuthor({
      db,
      auth,
      companyId,
      userId: caller.uid,
    });
    const footer = buildInquiryOfferFooterData({ company, identity, author });

    const planResult = await buildInquiryOfferSendPlan({ company, identity });
    const sendPreview =
      "error" in planResult
        ? null
        : {
            methodLabel: INQUIRY_OFFER_SEND_METHOD_LABELS[planResult.method],
            fromHeader: planResult.fromHeader,
            replyTo: planResult.replyTo,
            notice: planResult.sendNotice,
          };

    return NextResponse.json({
      ok: true,
      footer,
      sendPreview,
      sendPreviewError: "error" in planResult ? planResult.error : null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Chyba." },
      { status: 500 }
    );
  }
}
