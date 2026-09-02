import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanRunSearchBackfill } from "@/lib/search/permissions";
import { backfillCompanySearchIndex } from "@/lib/search/index-store";
import type { SearchEntityType } from "@/lib/search/types";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type BackfillBody = {
  companyId?: string;
  entityTypes?: SearchEntityType[];
  skipEmbedding?: boolean;
  maxPerType?: number;
};

function isCronAuthorized(request: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  const header = request.headers.get("x-cron-secret") || request.headers.get("authorization") || "";
  if (header === secret) return true;
  if (header.startsWith("Bearer ") && header.slice(7).trim() === secret) return true;
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
    }

    const cronOk = isCronAuthorized(request);
    let companyId = "";

    if (!cronOk) {
      const authHeader = request.headers.get("authorization") || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
      if (!caller) {
        return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
      }
      if (!callerCanRunSearchBackfill(caller)) {
        return NextResponse.json({ ok: false, error: "Pouze admin může spustit backfill." }, { status: 403 });
      }
      const body = (await request.json()) as BackfillBody;
      companyId = String(body.companyId ?? caller.companyId ?? "").trim();
      if (!companyId || !callerCanAccessCompany(caller, companyId)) {
        return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
      }

      const progress = await backfillCompanySearchIndex(db, companyId, {
        entityTypes: body.entityTypes,
        skipEmbedding: body.skipEmbedding,
        maxPerType: body.maxPerType,
      });

      return NextResponse.json({ ok: true, companyId, progress });
    }

    const body = (await request.json()) as BackfillBody;
    companyId = String(body.companyId ?? "").trim();
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
    }

    const progress = await backfillCompanySearchIndex(db, companyId, {
      entityTypes: body.entityTypes,
      skipEmbedding: body.skipEmbedding,
      maxPerType: body.maxPerType,
    });

    return NextResponse.json({ ok: true, companyId, progress });
  } catch (err) {
    console.error("[company/search/backfill]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Backfill se nezdařil." }, { status: 500 });
  }
}
