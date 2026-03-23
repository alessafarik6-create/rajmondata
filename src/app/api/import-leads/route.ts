import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import { parseLeadImportPayload, type LeadImportRow } from "@/lib/lead-import-parse";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 25_000;

function isAllowedImportUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Proxy pro import poptávek — načte URL z nastavení organizace na serveru (bez CORS v prohlížeči).
 * GET ?companyId=...
 * Authorization: Bearer &lt;idToken&gt;
 */
export async function GET(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json(
      { ok: false, error: "Server není nakonfigurován.", code: "server_config" },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) {
    return NextResponse.json(
      { ok: false, error: "Chybí přihlášení.", code: "unauthorized" },
      { status: 401 }
    );
  }

  let callerUid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    callerUid = decoded.uid;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Neplatný nebo expirovaný token.", code: "unauthorized" },
      { status: 401 }
    );
  }

  const companyId = String(request.nextUrl.searchParams.get("companyId") || "").trim();
  if (!companyId) {
    return NextResponse.json(
      { ok: false, error: "Chybí parametr companyId.", code: "bad_request" },
      { status: 400 }
    );
  }

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return NextResponse.json(
      { ok: false, error: "Profil neexistuje.", code: "forbidden" },
      { status: 403 }
    );
  }

  const callerCompany = String(caller.companyId || "").trim();
  const globalRoles = caller.globalRoles as string[] | undefined;
  const isSuper = Array.isArray(globalRoles) && globalRoles.includes("super_admin");

  if (!isSuper && callerCompany !== companyId) {
    return NextResponse.json(
      { ok: false, error: "Nemáte přístup k této organizaci.", code: "forbidden" },
      { status: 403 }
    );
  }

  let importUrl: string | null = null;
  try {
    const companyRef = db.collection(COMPANIES_COLLECTION).doc(companyId);
    const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(companyId);
    const [companySnap, orgSnap] = await Promise.all([companyRef.get(), orgRef.get()]);
    const fromCompany = companySnap.data()?.poptavkyImportUrl;
    const fromOrg = orgSnap.data()?.poptavkyImportUrl;
    const raw =
      (typeof fromCompany === "string" && fromCompany.trim()) ||
      (typeof fromOrg === "string" && fromOrg.trim()) ||
      "";
    importUrl = raw || null;
  } catch (e) {
    console.error("[import-leads] Firestore read failed", e);
    return NextResponse.json(
      { ok: false, error: "Nepodařilo se načíst nastavení organizace.", code: "settings_error" },
      { status: 500 }
    );
  }

  if (!importUrl) {
    console.info("[import-leads]", {
      companyId,
      importUrlPresent: false,
      httpStatus: null,
      contentType: null,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Není nastavená URL pro import poptávek",
        code: "missing_url",
      },
      { status: 400 }
    );
  }

  if (!isAllowedImportUrl(importUrl)) {
    return NextResponse.json(
      {
        ok: false,
        error: "URL pro import musí začínat http:// nebo https://",
        code: "invalid_url",
      },
      { status: 400 }
    );
  }

  const logSafeUrl = (() => {
    try {
      const u = new URL(importUrl);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      return "(neplatná URL)";
    }
  })();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(importUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "Rajmondata-import-leads/1.0",
      },
      cache: "no-store",
    });

    const contentType = upstream.headers.get("content-type") || "";
    const status = upstream.status;

    console.info("[import-leads]", {
      companyId,
      importUrl: logSafeUrl,
      importUrlPresent: true,
      httpStatus: status,
      contentType: contentType.split(";")[0]?.trim() || contentType,
    });

    if (!upstream.ok) {
      const msg =
        status >= 500
          ? "Externí server je dočasně nedostupný (chyba serveru)."
          : status === 404
            ? "Importní URL nebyla nalezena (404)."
            : `Externí zdroj vrátil chybu (HTTP ${status}).`;
      return NextResponse.json(
        { ok: false, error: msg, code: "upstream_http", details: { status } },
        { status: 502 }
      );
    }

    const text = await upstream.text();
    const trimmed = text.trim();

    if (!trimmed) {
      return NextResponse.json({
        ok: true,
        rows: [] as LeadImportRow[],
        warning: "Externí zdroj vrátil prázdnou odpověď.",
        code: "empty_body",
      });
    }

    const looksJson =
      trimmed.startsWith("{") || trimmed.startsWith("[");
    if (!looksJson) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Odpověď není JSON (očekává se pole nebo objekt). Zkontrolujte URL v nastavení organizace.",
          code: "invalid_format",
        },
        { status: 422 }
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(trimmed) as unknown;
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "Odpověď vypadá jako JSON, ale nelze ji parsovat.",
          code: "invalid_json",
        },
        { status: 422 }
      );
    }

    const rows = parseLeadImportPayload(json);

    return NextResponse.json({
      ok: true,
      rows,
      meta: {
        rawCount: Array.isArray(json)
          ? json.length
          : typeof json === "object" && json
            ? Object.keys(json as object).length
            : 0,
        parsedCount: rows.length,
      },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    const message = aborted
      ? "Časový limit při stahování importu (zkuste znovu nebo zkontrolujte URL)."
      : e instanceof Error && "cause" in e
        ? "Externí server je nedostupný nebo síť odmítla spojení."
        : "Nepodařilo se stáhnout data z externí URL.";

    console.error("[import-leads] fetch failed", {
      companyId,
      importUrl: logSafeUrl,
      aborted,
      err: e instanceof Error ? e.message : String(e),
    });

    return NextResponse.json(
      {
        ok: false,
        error: message,
        code: aborted ? "timeout" : "upstream_network",
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
