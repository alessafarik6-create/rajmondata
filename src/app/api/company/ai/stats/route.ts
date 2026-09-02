import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanManageAiCenter } from "@/lib/ai/permissions";
import { AI_GENERATIONS_COLLECTION } from "@/lib/ai/config";
import {
  AI_KNOWLEDGE_DOCUMENTS_COLLECTION,
  AI_PRICE_RULES_COLLECTION,
  AI_QUOTE_EXAMPLES_COLLECTION,
} from "@/lib/ai/ai-center-types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";

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
    if (!callerCanManageAiCenter(caller)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const companyId = String(request.nextUrl.searchParams.get("companyId") ?? "").trim();
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const base = db.collection(COMPANIES_COLLECTION).doc(companyId);

    const [priceRulesSnap, knowledgeSnap, examplesSnap, offersSnap, gensSnap] = await Promise.all([
      base.collection(AI_PRICE_RULES_COLLECTION).where("active", "==", true).limit(500).get(),
      base.collection(AI_KNOWLEDGE_DOCUMENTS_COLLECTION).where("active", "==", true).limit(200).get(),
      base.collection(AI_QUOTE_EXAMPLES_COLLECTION).where("active", "==", true).limit(200).get(),
      base.collection("inquiry_offers").where("useForAiExample", "==", true).limit(200).get(),
      base
        .collection(AI_GENERATIONS_COLLECTION)
        .where("status", "==", "completed")
        .orderBy("createdAt", "desc")
        .limit(1)
        .get(),
    ]);

    let lastGenerationAt: string | null = null;
    let avgConfidence: number | null = null;
    if (!gensSnap.empty) {
      const g = gensSnap.docs[0].data() as Record<string, unknown>;
      const created = g.createdAt as { toDate?: () => Date } | undefined;
      if (created?.toDate) lastGenerationAt = created.toDate().toISOString();
      const validated = g.validatedOutput as { confidence?: number } | undefined;
      if (validated?.confidence != null) avgConfidence = validated.confidence;
    }

    const recentGens = await base
      .collection(AI_GENERATIONS_COLLECTION)
      .where("status", "==", "completed")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();
    const confidences = recentGens.docs
      .map((d) => (d.data().validatedOutput as { confidence?: number } | undefined)?.confidence)
      .filter((c): c is number => c != null && Number.isFinite(c));
    if (confidences.length > 0) {
      avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    }

    return NextResponse.json({
      ok: true,
      stats: {
        activePriceRules: priceRulesSnap.size,
        knowledgeDocuments: knowledgeSnap.size,
        quoteExamples: examplesSnap.size + offersSnap.size,
        lastGenerationAt,
        avgConfidence,
      },
    });
  } catch (err) {
    console.error("[ai/stats]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Statistiky se nepodařily načíst." }, { status: 500 });
  }
}
