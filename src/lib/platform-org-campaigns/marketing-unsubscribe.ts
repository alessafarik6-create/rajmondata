import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  return (
    String(process.env.PLATFORM_MARKETING_UNSUBSCRIBE_SECRET ?? "").trim() ||
    String(process.env.SUPERADMIN_SESSION_SECRET ?? "").trim() ||
    "dev-marketing-unsub"
  );
}

export function buildMarketingUnsubscribeToken(organizationId: string): string {
  const id = String(organizationId ?? "").trim();
  return createHmac("sha256", secret()).update(id).digest("hex").slice(0, 32);
}

export function verifyMarketingUnsubscribeToken(
  organizationId: string,
  token: string
): boolean {
  const expected = buildMarketingUnsubscribeToken(organizationId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token ?? "").trim());
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function marketingUnsubscribeUrl(organizationId: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const token = buildMarketingUnsubscribeToken(organizationId);
  return `${base}/api/public/platform-marketing-unsubscribe?org=${encodeURIComponent(organizationId)}&token=${token}`;
}
