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

export function toAppPasswordResetUrl(firebaseLink: string): string {
  const base = appBaseUrl();
  if (!base) return firebaseLink;
  try {
    const u = new URL(firebaseLink);
    const oobCode = u.searchParams.get("oobCode");
    const mode = u.searchParams.get("mode");
    const apiKey = u.searchParams.get("apiKey");
    const lang = u.searchParams.get("lang");
    if (!oobCode || mode !== "resetPassword") return firebaseLink;
    const out = new URL(`${base}/login/obnova-hesla`);
    out.searchParams.set("mode", "resetPassword");
    out.searchParams.set("oobCode", oobCode);
    if (apiKey) out.searchParams.set("apiKey", apiKey);
    if (lang) out.searchParams.set("lang", lang);
    return out.toString();
  } catch {
    return firebaseLink;
  }
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

export function buildCustomerAccessEmailHtml(params: {
  portalName: string;
  organizationName: string;
  customerName: string;
  customerEmail: string;
  inviteUrl: string;
  loginUrl: string;
  logoUrl?: string | null;
  contactEmail?: string | null;
}): string {
  const contactRow = params.contactEmail
    ? `<p style="margin:6px 0 0;font-size:13px;color:#4b5563;">Kontakt: <a href="mailto:${escapeHtml(
        params.contactEmail
      )}" style="color:#c2410c;text-decoration:none;">${escapeHtml(params.contactEmail)}</a></p>`
    : "";
  return `
    <div style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="padding:22px 24px;background:#fff7ed;border-bottom:1px solid #fed7aa;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${
              params.logoUrl
                ? `<img src="${escapeHtml(params.logoUrl)}" alt="${escapeHtml(params.portalName)}" style="max-height:40px;max-width:140px;" />`
                : `<div style="font-weight:800;font-size:20px;letter-spacing:0.02em;color:#c2410c;">${escapeHtml(
                    params.portalName
                  )}</div>`
            }
          </div>
          <p style="margin:10px 0 0;font-size:13px;color:#9a3412;">Zákaznický portál ${escapeHtml(
            params.portalName
          )}</p>
        </div>

        <div style="padding:26px 24px;">
          <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#111827;">Byl Vám vytvořen přístup do zákaznického portálu.</h1>
          <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#374151;">Dobrý den ${escapeHtml(
            params.customerName
          )},</p>
          <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#374151;">
            organizace <strong>${escapeHtml(
              params.organizationName
            )}</strong> Vám poslala přístup do portálu <strong>${escapeHtml(
              params.portalName
            )}</strong>.
          </p>
          <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#374151;">
            Přihlašovací e-mail: <strong>${escapeHtml(params.customerEmail)}</strong>
          </p>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#374151;">
            Pro první přihlášení si nastavte heslo pomocí tlačítka níže.
          </p>

          <p style="margin:0 0 20px;">
            <a href="${escapeHtml(
              params.inviteUrl
            )}" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700;font-size:16px;">
              Nastavit heslo
            </a>
          </p>

          <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Odkaz do portálu:</p>
          <p style="margin:0 0 16px;font-size:14px;">
            <a href="${escapeHtml(params.loginUrl)}" style="color:#c2410c;text-decoration:none;">${escapeHtml(
              params.loginUrl
            )}</a>
          </p>

          <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0;" />
          <p style="margin:0;font-size:13px;color:#4b5563;">Odesílající organizace: ${escapeHtml(
            params.organizationName
          )}</p>
          ${contactRow}
        </div>
      </div>
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
