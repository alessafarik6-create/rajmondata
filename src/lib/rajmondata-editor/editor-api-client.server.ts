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

function parseEditorError(data: EditorErrorBody, status: number): string {
  if (data.code === "PORTAL_AUTH_NOT_CONFIGURED") {
    return "Editor nemá nastavené PORTAL_API_SECRET (Railway).";
  }
  if (status === 401 || data.code === "UNAUTHORIZED") {
    return "Editor odmítl požadavek (autentizace portálu nebo Firebase tokenu).";
  }
  return String(data.message ?? data.error ?? `Editor API HTTP ${status}`);
}

async function signedPost(
  apiUrl: string,
  path: string,
  payload: Record<string, unknown>
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string; code?: string }> {
  const body = serializePortalJsonBody(payload);
  let headers: Record<string, string>;
  try {
    headers = signPortalJsonBody(body).headers;
  } catch (e) {
    return {
      ok: false,
      status: 503,
      error: e instanceof Error ? e.message : "Chybí PORTAL_API_SECRET.",
    };
  }
  const url = `${apiUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetch(url, { method: "POST", headers, body, cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as EditorErrorBody & Record<string, unknown>;
    if (!res.ok) {
      const mappedStatus =
        res.status === 401 ? 502 : res.status >= 500 ? 503 : res.status;
      return {
        ok: false,
        status: mappedStatus,
        error: parseEditorError(data, res.status),
        code: data.code,
      };
    }
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      status: 503,
      error: e instanceof Error ? e.message : "Editor API nedostupné.",
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
}): Promise<{ ok: true; data: EditorLaunchTicketResponse } | { ok: false; status: number; error: string; code?: string }> {
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
    return { ok: false, status: 502, error: "Editor nevrátil ticket." };
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
}> {
  const healthUrl = `${apiUrl.replace(/\/$/, "")}/api/v1/health`;
  try {
    const res = await fetch(healthUrl, { cache: "no-store" });
    if (!res.ok) return { status: "error", detail: `Health HTTP ${res.status}` };
    const data = (await res.json()) as {
      ok?: boolean;
      portalAuthConfigured?: boolean;
    };
    if (data.ok !== true) return { status: "degraded", detail: "Health bez ok:true" };
    const secret = getRajmondataEditorEnv().secret;
    if (!secret) {
      return {
        status: "degraded",
        detail: "Chybí PORTAL_API_SECRET na portálu",
        portalAuthConfigured: data.portalAuthConfigured,
      };
    }
    if (data.portalAuthConfigured !== true) {
      return {
        status: "degraded",
        detail: "Editor: portalAuthConfigured=false (nastavte PORTAL_API_SECRET na Railway)",
        portalAuthConfigured: false,
      };
    }
    return {
      status: "connected",
      detail: "Health OK, obě strany mají portal auth",
      portalAuthConfigured: true,
    };
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "Health nedostupné" };
  }
}
