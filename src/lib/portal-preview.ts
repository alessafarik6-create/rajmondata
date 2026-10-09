/** Režim náhledu portálu jako zaměstnanec — uloženo v `users/{uid}.portalPreviewSession`. */

export type PortalPreviewSessionDoc = {
  employeeId: string;
  displayName: string;
  companyId: string;
  startedAtMs: number;
  expiresAtMs: number;
};

const PREVIEW_TTL_MS = 8 * 60 * 60 * 1000;

export function portalPreviewSessionFromFirestore(
  raw: unknown,
  nowMs: number = Date.now()
): PortalPreviewSessionDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const employeeId = String(o.employeeId ?? "").trim();
  const companyId = String(o.companyId ?? "").trim();
  const displayName = String(o.displayName ?? "").trim() || "Zaměstnanec";
  let expiresAtMs = Number(o.expiresAtMs);
  if (!Number.isFinite(expiresAtMs) && o.expiresAt != null) {
    const t = o.expiresAt as { toMillis?: () => number; toDate?: () => Date };
    if (typeof t.toMillis === "function") expiresAtMs = t.toMillis();
    else if (typeof t.toDate === "function") expiresAtMs = t.toDate().getTime();
  }
  let startedAtMs = Number(o.startedAtMs);
  if (!Number.isFinite(startedAtMs) && o.startedAt != null) {
    const t = o.startedAt as { toMillis?: () => number; toDate?: () => Date };
    if (typeof t.toMillis === "function") startedAtMs = t.toMillis();
    else if (typeof t.toDate === "function") startedAtMs = t.toDate().getTime();
  }
  if (!employeeId || !companyId) return null;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return null;
  return {
    employeeId,
    companyId,
    displayName,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : nowMs,
    expiresAtMs,
  };
}

export function buildNewPortalPreviewSession(params: {
  employeeId: string;
  displayName: string;
  companyId: string;
  nowMs?: number;
}): PortalPreviewSessionDoc {
  const nowMs = params.nowMs ?? Date.now();
  return {
    employeeId: params.employeeId,
    displayName: params.displayName,
    companyId: params.companyId,
    startedAtMs: nowMs,
    expiresAtMs: nowMs + PREVIEW_TTL_MS,
  };
}

export function canStartPortalPreviewAsAdmin(role: string, globalRoles?: string[] | null): boolean {
  const r = String(role || "").trim();
  if (r === "owner" || r === "admin") return true;
  return Array.isArray(globalRoles) && globalRoles.includes("super_admin");
}
