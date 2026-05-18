/**
 * Resend — ověřené domény a detekce chyb odeslání nabídek.
 */

const LOG = "[inquiry-offer-resend]";
const CACHE_TTL_MS = 5 * 60 * 1000;

type ResendDomainRow = { name: string; status: string };

let verifiedDomainsCache: { at: number; domains: Set<string> } | null = null;

export function parseEmailAddressFromFromHeader(raw: string): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const angle = /^([^<]*)<([^>]+)>$/.exec(t);
  if (angle) {
    const email = angle[2].trim().toLowerCase();
    return email.includes("@") ? email : null;
  }
  const bare = t.toLowerCase();
  return bare.includes("@") ? bare : null;
}

export function extractEmailDomain(email: string): string | null {
  const t = email.trim().toLowerCase();
  const at = t.lastIndexOf("@");
  if (at < 1) return null;
  const domain = t.slice(at + 1).trim();
  return domain || null;
}

/** E-maily, které nesmí být Reply-To u nabídek (platforma / noreply). */
export function isExcludedInquiryReplyToEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e || !e.includes("@")) return true;
  const platform = resolvePlatformFallbackSenderEmail();
  if (platform && e === platform) return true;
  const local = e.split("@")[0] ?? "";
  if (local === "noreply" || local === "no-reply" || local === "donotreply") return true;
  const platformDomain = platform ? extractEmailDomain(platform) : null;
  const domain = extractEmailDomain(e);
  if (platformDomain && domain && domain === platformDomain && local.includes("noreply")) {
    return true;
  }
  return false;
}

export function resolvePlatformFallbackSenderEmail(): string | null {
  const override = String(process.env.INQUIRY_OFFER_FALLBACK_FROM ?? "").trim();
  if (override) {
    const parsed = parseEmailAddressFromFromHeader(override);
    if (parsed) return parsed;
    if (override.includes("@")) return override.toLowerCase();
  }
  const fromEnv = String(process.env.EMAIL_FROM ?? "").trim();
  return parseEmailAddressFromFromHeader(fromEnv);
}

export function resolvePlatformFallbackDomain(): string | null {
  const email = resolvePlatformFallbackSenderEmail();
  return email ? extractEmailDomain(email) : null;
}

function readVerifiedDomainsFromEnv(): Set<string> {
  const raw = String(process.env.INQUIRY_OFFER_RESEND_VERIFIED_DOMAINS ?? "").trim();
  const out = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const d = part.trim().toLowerCase().replace(/^@/, "");
    if (d) out.add(d);
  }
  const platform = resolvePlatformFallbackDomain();
  if (platform) out.add(platform);
  return out;
}

async function fetchResendVerifiedDomainsFromApi(): Promise<Set<string>> {
  const key = String(process.env.RESEND_API_KEY ?? "").trim();
  if (!key) return new Set();

  try {
    const res = await fetch("https://api.resend.com/domains", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(LOG, "domains API failed", res.status);
      return new Set();
    }
    const json = (await res.json()) as { data?: ResendDomainRow[] };
    const rows = Array.isArray(json.data) ? json.data : [];
    const verified = new Set<string>();
    for (const row of rows) {
      const name = String(row.name ?? "").trim().toLowerCase();
      const status = String(row.status ?? "").trim().toLowerCase();
      if (name && (status === "verified" || status === "active")) {
        verified.add(name);
      }
    }
    return verified;
  } catch (err) {
    console.warn(LOG, "domains API error", err);
    return new Set();
  }
}

/** Ověřené domény v Resend (API + env + doména platformního FROM). */
export async function getResendVerifiedDomains(): Promise<Set<string>> {
  const now = Date.now();
  if (verifiedDomainsCache && now - verifiedDomainsCache.at < CACHE_TTL_MS) {
    return verifiedDomainsCache.domains;
  }
  const fromApi = await fetchResendVerifiedDomainsFromApi();
  const merged = new Set<string>([...readVerifiedDomainsFromEnv(), ...fromApi]);
  verifiedDomainsCache = { at: now, domains: merged };
  return merged;
}

export async function isResendDomainVerified(domain: string): Promise<boolean> {
  const d = domain.trim().toLowerCase().replace(/^@/, "");
  if (!d) return false;
  const verified = await getResendVerifiedDomains();
  return verified.has(d);
}

export async function isResendSenderDomainVerified(senderEmail: string): Promise<boolean> {
  const domain = extractEmailDomain(senderEmail);
  if (!domain) return false;
  return isResendDomainVerified(domain);
}

export function isResendDomainNotVerifiedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("domain is not verified") ||
    m.includes("domain has not been verified") ||
    m.includes("not verified") && m.includes("domain")
  );
}

export function friendlyInquiryOfferSendError(raw: string): string {
  if (isResendDomainNotVerifiedError(raw)) {
    return "Organizace nemá ověřenou e-mailovou doménu. Nabídka byla odeslána přes systémový e-mail portálu.";
  }
  return raw;
}
