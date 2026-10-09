import { createHash } from "crypto";

const PEPPER = process.env.PORTAL_ANALYTICS_PEPPER?.trim() || "rajmondata-portal-analytics-v1";

/** Pseudonymizovaný identifikátor uživatele — nevratný bez pepperu. */
export function portalAnalyticsUserHash(userId: string, organizationId: string): string {
  const uid = String(userId ?? "").trim();
  const org = String(organizationId ?? "").trim();
  if (!uid || !org) return "";
  return createHash("sha256")
    .update(`${PEPPER}|${org}|${uid}`)
    .digest("hex")
    .slice(0, 24);
}

export function portalAnalyticsDedupeKey(input: {
  organizationId: string;
  userHash: string;
  event: string;
  moduleId: string;
  actionKey?: string;
  minuteBucket: string;
}): string {
  const raw = [
    input.organizationId,
    input.userHash,
    input.event,
    input.moduleId,
    input.actionKey ?? "",
    input.minuteBucket,
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
