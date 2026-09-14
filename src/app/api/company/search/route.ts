import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanUseSearch } from "@/lib/search/permissions";
import { runCompanySearch } from "@/lib/search/search-service";
import type { SearchEntityType, SearchIntent } from "@/lib/search/types";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchBody = {
  companyId?: string;
  query?: string;
  filters?: Partial<SearchIntent>;
  limit?: number;
  knowledgeAnswer?: boolean;
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
    if (!callerCanUseSearch(caller)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění k vyhledávání." }, { status: 403 });
    }

    const body = (await request.json()) as SearchBody;
    const companyId = String(body.companyId ?? caller.companyId ?? "").trim();
    const query = String(body.query ?? "").trim();

    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const filters = body.filters;
    if (filters?.entityTypes) {
      filters.entityTypes = filters.entityTypes.filter(Boolean) as SearchEntityType[];
    }

    const result = await runCompanySearch({
      db,
      caller,
      companyId,
      query,
      filters,
      limit: typeof body.limit === "number" ? Math.min(60, body.limit) : undefined,
      debug: process.env.NODE_ENV !== "production" || process.env.SEARCH_DEBUG === "1",
      knowledgeAnswer: body.knowledgeAnswer === true,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[company/search]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Vyhledávání se nezdařilo." }, { status: 500 });
  }
}
