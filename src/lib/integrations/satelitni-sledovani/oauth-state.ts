import crypto from "node:crypto";

export function encodeOAuthState(organizationId: string): string {
  const payload = {
    organizationId: String(organizationId).trim(),
    nonce: crypto.randomBytes(16).toString("base64url"),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function parseOAuthState(state: string): { organizationId: string } | null {
  try {
    const raw = Buffer.from(String(state ?? ""), "base64url").toString("utf8");
    const j = JSON.parse(raw) as { organizationId?: string };
    const organizationId = String(j.organizationId ?? "").trim();
    if (!organizationId) return null;
    return { organizationId };
  } catch {
    return null;
  }
}
