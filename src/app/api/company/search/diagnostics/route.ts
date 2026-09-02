import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanRunSearchBackfill } from "@/lib/search/permissions";
import {
  countCompanySearchIndexRecords,
  countCompanySourceEntities,
} from "@/lib/search/live-search-candidates";
import { backfillCompanySearchIndex } from "@/lib/search/index-store";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

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

    const companyId = String(
      request.nextUrl.searchParams.get("companyId") ?? caller.companyId ?? ""
    ).trim();
    if (!companyId || !callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const runBackfill = request.nextUrl.searchParams.get("backfill") === "1";
    let backfillProgress = null;

    if (runBackfill) {
      if (!callerCanRunSearchBackfill(caller)) {
        return NextResponse.json({ ok: false, error: "Backfill jen pro admin." }, { status: 403 });
      }
      backfillProgress = await backfillCompanySearchIndex(db, companyId, {
        skipEmbedding: request.nextUrl.searchParams.get("skipEmbedding") === "1",
      });
    }

    const indexBefore = await countCompanySearchIndexRecords(db, companyId);
    const sourceCounts = await countCompanySourceEntities(db, companyId);

    return NextResponse.json({
      ok: true,
      companyId,
      sourceCounts,
      searchIndex: indexBefore,
      backfillProgress,
    });
  } catch (err) {
    console.error("[company/search/diagnostics]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Diagnostika se nezdařila." }, { status: 500 });
  }
}
