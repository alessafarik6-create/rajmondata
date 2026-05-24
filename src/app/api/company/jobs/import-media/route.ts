import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import {
  copyJobMediaFromSourceJob,
  listJobMediaForImport,
} from "@/lib/job-media-import-admin";
import type {
  JobMediaImportItemKind,
  JobMediaImportSelectionRef,
} from "@/lib/job-media-import-types";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function canImportJobMedia(role: string): boolean {
  return ["owner", "admin", "manager", "accountant", "employee"].includes(role);
}

export async function GET(request: NextRequest) {
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
    if (caller.role === "customer") {
      return NextResponse.json({ ok: false, error: "Zákazník nemá přístup." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = String(searchParams.get("companyId") ?? "").trim();
    const sourceJobId = String(searchParams.get("sourceJobId") ?? "").trim();

    if (!companyId || !sourceJobId) {
      return NextResponse.json(
        { ok: false, error: "Chybí companyId nebo sourceJobId." },
        { status: 400 }
      );
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }
    if (!canImportJobMedia(caller.role)) {
      return NextResponse.json(
        { ok: false, error: "Nemáte oprávnění importovat soubory." },
        { status: 403 }
      );
    }

    const items = await listJobMediaForImport(db, companyId, sourceJobId);
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errorMessageFromUnknown(e) },
      { status: 500 }
    );
  }
}

type PostBody = {
  companyId?: string;
  sourceJobId?: string;
  targetJobId?: string;
  jobDisplayName?: string | null;
  items?: JobMediaImportSelectionRef[];
};

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
    if (caller.role === "customer") {
      return NextResponse.json({ ok: false, error: "Zákazník nemá přístup." }, { status: 403 });
    }

    const body = (await request.json()) as PostBody;
    const companyId = String(body.companyId ?? "").trim();
    const sourceJobId = String(body.sourceJobId ?? "").trim();
    const targetJobId = String(body.targetJobId ?? "").trim();
    const jobDisplayName =
      typeof body.jobDisplayName === "string" ? body.jobDisplayName.trim() : null;
    const items = Array.isArray(body.items) ? body.items : [];

    if (!companyId || !sourceJobId || !targetJobId) {
      return NextResponse.json(
        { ok: false, error: "Chybí identifikátory zakázek." },
        { status: 400 }
      );
    }
    if (!items.length) {
      return NextResponse.json(
        { ok: false, error: "Vyberte alespoň jeden soubor." },
        { status: 400 }
      );
    }
    if (items.length > 80) {
      return NextResponse.json(
        { ok: false, error: "Maximálně 80 souborů najednou." },
        { status: 400 }
      );
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }
    if (!canImportJobMedia(caller.role)) {
      return NextResponse.json(
        { ok: false, error: "Nemáte oprávnění importovat soubory." },
        { status: 403 }
      );
    }

    const normalized: JobMediaImportSelectionRef[] = items
      .map((it) => {
        const kind: JobMediaImportItemKind =
          it.kind === "legacyPhoto" ? "legacyPhoto" : "folderImage";
        return {
          kind,
          id: String(it.id ?? "").trim(),
          folderId:
            kind === "folderImage" ? String(it.folderId ?? "").trim() : undefined,
        };
      })
      .filter((it) => it.id);

    const result = await copyJobMediaFromSourceJob({
      db,
      companyId,
      sourceJobId,
      targetJobId,
      userId: caller.uid,
      jobDisplayName,
      items: normalized,
    });

    return NextResponse.json({
      ok: true,
      copied: result.copied,
      failed: result.failed,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errorMessageFromUnknown(e) },
      { status: 500 }
    );
  }
}
