import "server-only";

import { getRajmondataEditorEnv } from "@/lib/rajmondata-editor/config";
import {
  serializePortalJsonBody,
  signPortalJsonBody,
} from "@/lib/rajmondata-editor/portal-api-sign.server";

export type EditorLaunchTicketResponse = {
  ticket: string;
  expiresAt?: string;
};

type EditorErrorBody = { ok?: boolean; code?: string; message?: string; error?: string };

export function parseEditorApiError(data: EditorErrorBody, httpStatus: number): string {
  const code = String(data.code ?? "").trim();
  const msg = String(data.message ?? data.error ?? "").trim();

  if (code === "PORTAL_AUTH_NOT_CONFIGURED") {
    return "Editor nemá nastavené PORTAL_API_SECRET (Railway).";
  }
  if (code === "PORTAL_SIGNATURE") {
    return "Podpis požadavku na editor neprošel — ověřte shodu PORTAL_API_SECRET na Vercelu a Railway.";
  }
  if (
    code === "FIREBASE_NOT_CONFIGURED" ||
    code === "FIREBASE_ADMIN_NOT_CONFIGURED" ||
    /firebase.*n(e)?nastav/i.test(msg)
  ) {
    return (
      "Editor na Railway nemá nakonfigurované Firebase Admin credentials. " +
      "V Railway nastavte proměnné pro service account (např. FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) " +
      "podle dokumentace editoru a restartujte službu."
    );
  }
  if (code === "BAD_INPUT") {
    return msg || "Neplatná data pro editor API.";
  }
  if (httpStatus === 401 || code === "UNAUTHORIZED") {
    return msg || "Editor odmítl požadavek (autentizace portálu nebo Firebase tokenu).";
  }
  return msg || `Editor API HTTP ${httpStatus}`;
}

/** Mapování HTTP odpovědi editoru na status pro klienta portálu. */
export function mapEditorHttpToPortalStatus(httpStatus: number, code?: string): number {
  const c = String(code ?? "").trim();
  if (c === "PORTAL_AUTH_NOT_CONFIGURED" || c === "PORTAL_SIGNATURE" || c === "FIREBASE_NOT_CONFIGURED") {
    return 503;
  }
  if (c === "FIREBASE_ADMIN_NOT_CONFIGURED") return 503;
  if (httpStatus === 400) return 400;
  if (httpStatus === 401 || httpStatus === 403) return 503;
  if (httpStatus === 404) return 502;
  if (httpStatus >= 500) return 503;
  if (httpStatus >= 400) return httpStatus;
  return 502;
}

async function signedPost(
  apiUrl: string,
  path: string,
  payload: Record<string, unknown>
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string; code?: string; editorHttpStatus: number }
> {
  const body = serializePortalJsonBody(payload);
  let headers: Record<string, string>;
  try {
    headers = signPortalJsonBody(body).headers;
  } catch (e) {
    return {
      ok: false,
      status: 503,
      error: e instanceof Error ? e.message : "Chybí PORTAL_API_SECRET.",
      code: "PORTAL_SECRET_MISSING",
      editorHttpStatus: 0,
    };
  }
  const url = `${apiUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetch(url, { method: "POST", headers, body, cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as EditorErrorBody & Record<string, unknown>;
    if (!res.ok) {
      const code = data.code ? String(data.code) : undefined;
      const mappedStatus = mapEditorHttpToPortalStatus(res.status, code);
      const error = parseEditorApiError(data, res.status);
      console.warn("[editor-api] request failed", {
        path,
        editorHttpStatus: res.status,
        editorCode: code ?? null,
        portalStatus: mappedStatus,
      });
      return {
        ok: false,
        status: mappedStatus,
        error,
        code,
        editorHttpStatus: res.status,
      };
    }
    return { ok: true, data };
  } catch (e) {
    console.warn("[editor-api] fetch error", {
      path,
      message: e instanceof Error ? e.message : String(e),
    });
    return {
      ok: false,
      status: 503,
      error: e instanceof Error ? e.message : "Editor API nedostupné.",
      code: "EDITOR_UNREACHABLE",
      editorHttpStatus: 0,
    };
  }
}

export async function requestEditorLaunchTicket(input: {
  apiUrl: string;
  idToken: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  email: string;
  displayName: string;
  moduleActive: boolean;
  licenseActive: boolean;
}): Promise<
  | { ok: true; data: EditorLaunchTicketResponse }
  | { ok: false; status: number; error: string; code?: string; editorHttpStatus?: number }
> {
  const res = await signedPost(input.apiUrl, "/api/v1/launch-tickets", {
    idToken: input.idToken,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    moduleActive: input.moduleActive,
    licenseActive: input.licenseActive,
  });
  if (!res.ok) return res;
  const ticket = String(res.data.ticket ?? "").trim();
  if (!ticket) {
    return {
      ok: false,
      status: 502,
      error: "Editor nevrátil ticket.",
      code: "MISSING_TICKET",
      editorHttpStatus: 200,
    };
  }
  return {
    ok: true,
    data: {
      ticket,
      expiresAt: res.data.expiresAt ? String(res.data.expiresAt) : undefined,
    },
  };
}

export type EditorAccessSyncPayload = {
  organizationId: string;
  moduleActive: boolean;
  licenseActive: boolean;
  users: Array<{ userId: string; active: boolean }>;
};

export async function syncEditorModuleAccess(
  apiUrl: string,
  payload: EditorAccessSyncPayload
): Promise<{ ok: true } | { ok: false; status: number; error: string; code?: string }> {
  const res = await signedPost(apiUrl, "/api/v1/modules/rajmondata-editor/access", payload);
  if (!res.ok) return res;
  return { ok: true };
}

export async function requestEditorLogout(input: {
  apiUrl: string;
  idToken: string;
  organizationId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await signedPost(input.apiUrl, "/api/v1/logout", {
    idToken: input.idToken,
    organizationId: input.organizationId,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

export async function probeEditorIntegrationHealth(apiUrl: string): Promise<{
  status: "connected" | "degraded" | "error";
  detail: string;
  portalAuthConfigured?: boolean;
  firebaseConfigured?: boolean;
}> {
  const healthUrl = `${apiUrl.replace(/\/$/, "")}/api/v1/health`;
  try {
    const res = await fetch(healthUrl, { cache: "no-store" });
    if (!res.ok) return { status: "error", detail: `Health HTTP ${res.status}` };
    const data = (await res.json()) as {
      ok?: boolean;
      portalAuthConfigured?: boolean;
      firebaseConfigured?: boolean;
    };
    if (data.ok !== true) return { status: "degraded", detail: "Health bez ok:true" };
    const secret = getRajmondataEditorEnv().secret;
    if (!secret) {
      return {
        status: "degraded",
        detail: "Chybí PORTAL_API_SECRET na portálu (Vercel)",
        portalAuthConfigured: data.portalAuthConfigured,
        firebaseConfigured: data.firebaseConfigured,
      };
    }
    if (data.portalAuthConfigured !== true) {
      return {
        status: "degraded",
        detail: "Editor: portalAuthConfigured=false (nastavte PORTAL_API_SECRET na Railway)",
        portalAuthConfigured: false,
        firebaseConfigured: data.firebaseConfigured,
      };
    }
    if (data.firebaseConfigured !== true) {
      return {
        status: "degraded",
        detail:
          "Editor: firebaseConfigured=false — na Railway nastavte Firebase Admin credentials pro ověření ID tokenů.",
        portalAuthConfigured: true,
        firebaseConfigured: false,
      };
    }
    return {
      status: "connected",
      detail: "Health OK, portal auth i Firebase na editoru",
      portalAuthConfigured: true,
      firebaseConfigured: true,
    };
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "Health nedostupné" };
  }
}
