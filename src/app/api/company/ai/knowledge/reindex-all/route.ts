import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanManageAiCenter } from "@/lib/ai/permissions";
import { reindexAllKnowledgeDocuments } from "@/lib/ai/knowledge-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Body = { companyId?: string };

export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    const bucket = getAdminStorageBucket();
    if (!db || !auth || !bucket) {
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
    const companyId = String(body.companyId ?? "").trim();
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const summary = await reindexAllKnowledgeDocuments(db, bucket, companyId);

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[ai/knowledge/reindex-all]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Přeindexování selhalo." },
      { status: 500 }
    );
  }
}
