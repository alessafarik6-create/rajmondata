import "server-only";

import { getRajmondataEditorEnv } from "@/lib/rajmondata-editor/config";

export type EditorLaunchTicketResponse = {
  ticket: string;
  expiresAt?: string;
  consumeUrl: string;
};

export async function requestEditorLaunchTicket(input: {
  apiUrl: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  email: string;
  displayName: string;
  moduleCode: string;
}): Promise<{ ok: true; data: EditorLaunchTicketResponse } | { ok: false; status: number; error: string }> {
  const { secret, launchPath } = getRajmondataEditorEnv();
  if (!secret) {
    return { ok: false, status: 503, error: "RAJMONDATA_EDITOR_INTEGRATION_SECRET není nastaveno." };
  }
  const url = `${input.apiUrl.replace(/\/$/, "")}${launchPath.startsWith("/") ? launchPath : `/${launchPath}`}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: input.organizationId,
        organizationName: input.organizationName,
        userId: input.userId,
        email: input.email,
        displayName: input.displayName,
        moduleCode: input.moduleCode,
        locale: "cs-CZ",
      }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: String(data.error ?? data.message ?? `Editor API HTTP ${res.status}`),
      };
    }
    const consumeUrl = String(data.consumeUrl ?? "").trim();
    const ticket = String(data.ticket ?? "").trim();
    if (!consumeUrl && !ticket) {
      return { ok: false, status: 502, error: "Editor API nevrátilo consumeUrl ani ticket." };
    }
    const appBase = getRajmondataEditorEnv().appUrl.replace(/\/$/, "");
    return {
      ok: true,
      data: {
        ticket,
        expiresAt: data.expiresAt ? String(data.expiresAt) : undefined,
        consumeUrl:
          consumeUrl ||
          `${appBase}/auth/portal/launch?ticket=${encodeURIComponent(ticket)}`,
      },
    };
  } catch (e) {
    return {
      ok: false,
      status: 503,
      error: e instanceof Error ? e.message : "Editor API nedostupné.",
    };
  }
}

export async function revokeEditorAccess(input: {
  apiUrl: string;
  organizationId: string;
  userId?: string | null;
  reason: string;
}): Promise<void> {
  const { secret, revokePath } = getRajmondataEditorEnv();
  if (!secret) return;
  const url = `${input.apiUrl.replace(/\/$/, "")}${revokePath.startsWith("/") ? revokePath : `/${revokePath}`}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        reason: input.reason,
      }),
    });
  } catch {
    // best effort
  }
}

export async function probeEditorIntegrationHealth(apiUrl: string): Promise<{
  status: "connected" | "degraded" | "error";
  detail: string;
}> {
  const healthUrl = `${apiUrl.replace(/\/$/, "")}/api/health`;
  try {
    const res = await fetch(healthUrl, { cache: "no-store" });
    if (!res.ok) return { status: "error", detail: `Health HTTP ${res.status}` };
    const data = (await res.json()) as { ok?: boolean };
    if (data.ok !== true) return { status: "degraded", detail: "Health bez ok:true" };
    const { secret } = getRajmondataEditorEnv();
    if (!secret) return { status: "degraded", detail: "Chybí integrační secret na portálu" };
    return { status: "connected", detail: "Health OK, secret nastaven" };
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "Health nedostupné" };
  }
}
