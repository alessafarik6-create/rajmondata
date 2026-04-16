import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import { parseLeadImportPayload, type LeadImportRow } from "@/lib/lead-import-parse";
import { syncImportLeadsToFirestoreAdmin } from "@/lib/import-lead-sync-firestore";
import { sendModuleNotification } from "@/lib/email-notifications/module-notify";

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

  const logSafeUrl = (() => {
    try {
      const u = new URL(importUrl);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      return "(neplatná URL)";
    }
  })();

  if (!isAllowedImportUrl(importUrl)) {
    console.warn("[import-leads] invalid URL (not http/https), fetch skipped", {
      companyId,
      importUrl: logSafeUrl,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Neplatná URL",
        code: "invalid_url",
        importUrlDebug: logSafeUrl,
      },
      { status: 400 }
    );
  }

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
    const statusText = upstream.statusText || "";

    console.info("[import-leads] upstream response", {
      companyId,
      importUrl: logSafeUrl,
      responseStatus: status,
      responseStatusText: statusText,
      contentType: contentType.split(";")[0]?.trim() || contentType,
    });

    if (!upstream.ok) {
      const msg =
        status >= 500
          ? "Chyba serveru zdroje poptávek"
          : status === 404
            ? "Importní URL neexistuje (404)"
            : `Externí zdroj vrátil chybu (HTTP ${status}).`;
      console.warn("[import-leads] upstream not ok", {
        importUrl: logSafeUrl,
        responseStatus: status,
        responseStatusText: statusText,
      });
      return NextResponse.json(
        {
          ok: false,
          error: msg,
          code: "upstream_http",
          details: { status, statusText },
          importUrlDebug: logSafeUrl,
        },
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
          importUrlDebug: logSafeUrl,
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
          importUrlDebug: logSafeUrl,
        },
        { status: 422 }
      );
    }

    const rows = parseLeadImportPayload(json);

    let sync:
      | {
          created: number;
          updated: number;
          skipped: number;
          total: number;
        }
      | undefined;
    let syncWarning: string | undefined;
    try {
      sync = await syncImportLeadsToFirestoreAdmin(
        db,
        companyId,
        rows,
        importUrl
      );
    } catch (e) {
      console.error("[import-leads] Firestore sync failed", e);
      syncWarning =
        "Nepodařilo se uložit synchronizaci do databáze (poptávky se zobrazí z JSON, ale stav v systému může být zastaralý).";
    }

    try {
      if (syncWarning) {
        await sendModuleNotification(db, {
          companyId,
          module: "system",
          eventKey: "importError",
          entityId: `import-leads-${companyId}`,
          title: "Chyba synchronizace importu poptávek",
          lines: [syncWarning],
          actionPath: "/portal/leads",
        });
      } else if (sync && sync.created > 0) {
        await sendModuleNotification(db, {
          companyId,
          module: "leads",
          eventKey: "newLead",
          entityId: `import-${companyId}-${Date.now()}`,
          title: `Import poptávek: ${sync.created} nových záznamů`,
          lines: [
            `Aktualizováno: ${sync.updated}, přeskočeno: ${sync.skipped}, celkem v dávce: ${sync.total}.`,
          ],
          actionPath: "/portal/leads",
        });
      }
    } catch (notifyErr) {
      console.warn("[import-leads] email notification skipped", notifyErr);
    }

    return NextResponse.json({
      ok: true,
      rows,
      ...(sync ? { sync } : {}),
      ...(syncWarning ? { warning: syncWarning } : {}),
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
      : "Nelze se připojit k URL";

    console.error("[import-leads] fetch failed", {
      companyId,
      importUrl: logSafeUrl,
      responseStatus: null,
      responseStatusText: null,
      aborted,
      err: e instanceof Error ? e.message : String(e),
    });

    return NextResponse.json(
      {
        ok: false,
        error: message,
        code: aborted ? "timeout" : "upstream_network",
        importUrlDebug: logSafeUrl,
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
