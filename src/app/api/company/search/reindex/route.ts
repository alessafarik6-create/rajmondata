import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanUseSearch } from "@/lib/search/permissions";
import { reindexEntity } from "@/lib/search/index-store";
import type { SearchEntityType } from "@/lib/search/types";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ReindexBody = {
  companyId?: string;
  entityType?: SearchEntityType;
  entityId?: string;
  extraSearchText?: string;
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
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }

    const body = (await request.json()) as ReindexBody;
    const companyId = String(body.companyId ?? caller.companyId ?? "").trim();
    const entityType = body.entityType;
    const entityId = String(body.entityId ?? "").trim();

    if (!companyId || !entityType || !entityId) {
      return NextResponse.json({ ok: false, error: "Chybí parametry." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const outcome = await reindexEntity(db, companyId, entityType, entityId, {
      extraSearchText: body.extraSearchText,
    });

    return NextResponse.json({ ok: outcome.ok, reason: outcome.reason });
  } catch (err) {
    console.error("[company/search/reindex]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Reindex se nezdařil." }, { status: 500 });
  }
}
