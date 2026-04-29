import type { Firestore } from "firebase-admin/firestore";

function trimString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function normalizeEmail(v: unknown): string {
  return trimString(v).toLowerCase();
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function appBaseUrl(): string {
  return String(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "")
    .trim()
    .replace(/\/$/, "");
}

export function absoluteUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const base = appBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}

export type CompanyEmailBranding = {
  companyName: string;
  contactEmail: string | null;
  logoUrl: string | null;
};

export async function loadCompanyEmailBranding(
  db: Firestore,
  companyId: string
): Promise<CompanyEmailBranding> {
  const companySnap = await db.collection("companies").doc(companyId).get();
  const raw = (companySnap.data() ?? {}) as Record<string, unknown>;
  const companyName =
    trimString(raw.companyName) || trimString(raw.name) || "Rajmondata";
  const contactEmail = normalizeEmail(
    raw.contactEmail ?? raw.email ?? raw.companyEmail
  );
  const logoUrl =
    trimString(raw.logoUrl) ||
    trimString(raw.companyLogoUrl) ||
    trimString(raw.brandLogoUrl) ||
    null;
  return {
    companyName,
    contactEmail: isValidEmail(contactEmail) ? contactEmail : null,
    logoUrl: logoUrl || null,
  };
}

export async function resolveCustomerEmailForJob(params: {
  db: Firestore;
  companyId: string;
  job: Record<string, unknown>;
}): Promise<string | null> {
  const fromJob = normalizeEmail(params.job.customerEmail);
  if (isValidEmail(fromJob)) return fromJob;

  const customerId =
    trimString(params.job.customerId) ||
    trimString(params.job.customerRecordId) ||
    "";
  if (!customerId) return null;
  const cSnap = await params.db
    .collection("companies")
    .doc(params.companyId)
    .collection("customers")
    .doc(customerId)
    .get();
  const c = (cSnap.data() ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(c.email ?? c.customerPortalEmail);
  return isValidEmail(email) ? email : null;
}

export async function resolveCustomerEmailByCustomerId(params: {
  db: Firestore;
  companyId: string;
  customerId: string;
}): Promise<string | null> {
  const cSnap = await params.db
    .collection("companies")
    .doc(params.companyId)
    .collection("customers")
    .doc(params.customerId)
    .get();
  if (!cSnap.exists) return null;
  const c = (cSnap.data() ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(c.customerPortalEmail ?? c.email);
  return isValidEmail(email) ? email : null;
}

export function wrapPortalEmailHtml(params: {
  greeting: string;
  paragraphs: string[];
  actionUrl?: string | null;
  actionLabel?: string;
  companyName: string;
  logoUrl?: string | null;
  contactEmail?: string | null;
}): string {
  const rows = params.paragraphs
    .map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>`)
    .join("");
  const action =
    params.actionUrl && params.actionUrl.trim()
      ? `<p style="margin:16px 0 16px;"><a href="${escapeHtml(
          params.actionUrl
        )}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:600;">${escapeHtml(
          params.actionLabel || "Otevřít portál"
        )}</a></p>`
      : "";
  return `
    <div style="font-family:system-ui,Segoe UI,sans-serif;font-size:15px;color:#111;line-height:1.45;max-width:620px;">
      ${
        params.logoUrl
          ? `<p style="margin:0 0 14px;"><img src="${escapeHtml(
              params.logoUrl
            )}" alt="${escapeHtml(params.companyName)}" style="max-height:48px;max-width:180px;"/></p>`
          : ""
      }
      <p style="margin:0 0 12px;">${escapeHtml(params.greeting)}</p>
      ${rows}
      ${action}
      <p style="margin-top:18px;">S pozdravem<br/>${escapeHtml(
        params.companyName
      )}</p>
      ${
        params.contactEmail
          ? `<p style="margin-top:10px;font-size:12px;color:#666;">Kontakt: ${escapeHtml(
              params.contactEmail
            )}</p>`
          : ""
      }
    </div>
  `.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
