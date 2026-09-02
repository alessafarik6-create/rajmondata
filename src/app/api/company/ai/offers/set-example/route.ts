import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanManageAiCenter } from "@/lib/ai/permissions";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";

type Body = {
  companyId?: string;
  offerId?: string;
  useForAiExample?: boolean;
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
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const body = (await request.json()) as Body;
    const companyId = String(body.companyId ?? "").trim();
    const offerId = String(body.offerId ?? "").trim();
    if (!companyId || !offerId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId nebo offerId." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const ref = db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("inquiry_offers")
      .doc(offerId);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Nabídka nenalezena." }, { status: 404 });
    }

    await ref.update({
      useForAiExample: body.useForAiExample === true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: caller.uid,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[ai/offers/set-example]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Uložení se nezdařilo." }, { status: 500 });
  }
}
