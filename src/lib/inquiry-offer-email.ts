/**
 * E-mailové nabídky k poptávkám — šablony, identita organizace, proměnné, HTML.
 */

import type { LeadImportRow } from "@/lib/lead-import-parse";
import { isExcludedInquiryReplyToEmail } from "@/lib/inquiry-offer-resend";

export const INQUIRY_OFFER_MISSING_REPLY_ERROR =
  "Doplňte e-mail pro odpovědi v nastavení organizace.";

export const INQUIRY_WORKFLOW_STATUSES = [
  "nova",
  "rozpracovano",
  "nabidka_pripravena",
  "nabidka_odeslana",
  "uzavreno",
] as const;

export type InquiryWorkflowStatus = (typeof INQUIRY_WORKFLOW_STATUSES)[number];

export const INQUIRY_WORKFLOW_STATUS_LABELS: Record<InquiryWorkflowStatus, string> = {
  nova: "Nová",
  rozpracovano: "Rozpracováno",
  nabidka_pripravena: "Nabídka připravena",
  nabidka_odeslana: "Nabídka odeslána",
  uzavreno: "Uzavřeno",
};

export type InquiryOfferTemplate = {
  id?: string;
  companyId?: string;
  name: string;
  subject: string;
  bodyText: string;
  active: boolean;
  isDefault: boolean;
  sortOrder?: number;
  updatedAt?: unknown;
  createdAt?: unknown;
};

export type InquiryEmailSmtpSettings = {
  enabled?: boolean;
  host?: string | null;
  port?: number | null;
  secure?: boolean;
  user?: string | null;
  password?: string | null;
};

export type InquiryEmailIdentity = {
  displayName?: string | null;
  contactEmail?: string | null;
  senderEmail?: string | null;
  replyToEmail?: string | null;
  offerReplyEmail?: string | null;
  phone?: string | null;
  web?: string | null;
  emailSignatureHtml?: string | null;
  smtp?: InquiryEmailSmtpSettings | null;
};

export type InquiryOfferSendMethod =
  | "org_smtp"
  | "org_resend_verified"
  | "platform_fallback";

export type InquiryOfferRecord = {
  id?: string;
  companyId?: string;
  leadKey: string;
  importLeadId?: string;
  status: "draft" | "sent";
  to: string;
  subject: string;
  bodyHtml: string;
  bodyPlain: string;
  priceGross?: number | null;
  internalNote?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  sentAt?: unknown;
  sentByUid?: string | null;
  sentByEmail?: string | null;
  sentByName?: string | null;
  /** Technická adresa odesílatele (From). */
  fromEmail?: string | null;
  fromDisplayName?: string | null;
  replyToEmail?: string | null;
  technicalFrom?: string | null;
  displayFrom?: string | null;
  replyTo?: string | null;
  sendingMode?: InquiryOfferSendMethod | null;
  messageId?: string | null;
  threadId?: string | null;
  /** @deprecated použijte sendingMode / sendMethod */
  smtpUsed?: boolean;
  sendMethod?: InquiryOfferSendMethod | null;
  usedPlatformFallback?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailAddress(email: string): boolean {
  const t = email.trim();
  return t.length > 3 && t.length <= 254 && EMAIL_RE.test(t);
}

export function readInquiryEmailIdentity(
  company: Record<string, unknown> | null | undefined
): InquiryEmailIdentity {
  const raw = company?.inquiryEmailIdentity;
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const smtpRaw = o.smtp;
  let smtp: InquiryEmailSmtpSettings | null = null;
  if (smtpRaw && typeof smtpRaw === "object") {
    const s = smtpRaw as Record<string, unknown>;
    smtp = {
      enabled: s.enabled === true,
      host: s.host != null ? String(s.host).trim() || null : null,
      port: Number.isFinite(Number(s.port)) ? Number(s.port) : null,
      secure: s.secure === true,
      user: s.user != null ? String(s.user).trim() || null : null,
      password: s.password != null ? String(s.password) : null,
    };
  }
  return {
    displayName: strOrNull(o.displayName),
    contactEmail: strOrNull(o.contactEmail),
    senderEmail: strOrNull(o.senderEmail),
    replyToEmail: strOrNull(o.replyToEmail),
    offerReplyEmail: strOrNull(o.offerReplyEmail),
    phone: strOrNull(o.phone),
    web: strOrNull(o.web),
    emailSignatureHtml: strOrNull(o.emailSignatureHtml),
    smtp,
  };
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}

export function resolveOrganizationDisplayName(
  company: Record<string, unknown>,
  identity: InquiryEmailIdentity
): string {
  return (
    identity.displayName?.trim() ||
    String(company.companyName ?? company.name ?? "").trim() ||
    "Organizace"
  );
}

/**
 * Priorita Reply-To u nabídek:
 * 1. e-mail pro odpovědi na nabídky
 * 2. reply-to e-mail
 * 3. e-mail odesílatele organizace
 * 4. hlavní kontaktní e-mail organizace
 * (nikdy platformní noreply)
 */
export function resolveInquiryReplyToEmail(
  identity: InquiryEmailIdentity,
  company: Record<string, unknown>
): string | null {
  const candidates = [
    identity.offerReplyEmail,
    identity.replyToEmail,
    identity.senderEmail,
    identity.contactEmail,
    String(company.email ?? "").trim() || null,
  ];
  for (const c of candidates) {
    const t = c?.trim();
    if (!t || !isValidEmailAddress(t)) continue;
    const norm = t.toLowerCase();
    if (isExcludedInquiryReplyToEmail(norm)) continue;
    return norm;
  }
  return null;
}

export function resolveInquirySenderEmail(
  identity: InquiryEmailIdentity,
  company: Record<string, unknown>,
  smtpEnabled: boolean
): string | null {
  if (smtpEnabled && identity.smtp?.user?.trim() && isValidEmailAddress(identity.smtp.user)) {
    return identity.smtp.user.trim().toLowerCase();
  }
  const candidates = [
    identity.senderEmail,
    identity.contactEmail,
    String(company.email ?? "").trim() || null,
  ];
  for (const c of candidates) {
    const t = c?.trim();
    if (t && isValidEmailAddress(t)) return t.toLowerCase();
  }
  return null;
}

export function isInquirySmtpConfigured(identity: InquiryEmailIdentity): boolean {
  const smtp = identity.smtp;
  if (!smtp?.enabled) return false;
  const host = String(smtp.host ?? "").trim();
  const user = String(smtp.user ?? "").trim();
  const pass = String(smtp.password ?? "");
  return Boolean(host && user && pass);
}

export function buildInquiryOfferThreadId(companyId: string, leadKey: string): string {
  const cid = String(companyId).trim();
  const lk = String(leadKey).trim();
  return `inquiry-offer-${cid}-${lk}`;
}

export type InquiryTemplateVariables = {
  jmeno: string;
  email: string;
  telefon: string;
  adresa: string;
  typ_poptavky: string;
  zprava: string;
  cena: string;
  firma: string;
  datum: string;
};

export function buildInquiryTemplateVariables(params: {
  lead: LeadImportRow;
  companyName: string;
  priceGross?: number | null;
}): InquiryTemplateVariables {
  const { lead, companyName, priceGross } = params;
  const price =
    priceGross != null && Number.isFinite(priceGross)
      ? `${Math.round(priceGross).toLocaleString("cs-CZ")} Kč`
      : lead.orientacniCenaKc != null && Number.isFinite(lead.orientacniCenaKc)
        ? `${Math.round(lead.orientacniCenaKc).toLocaleString("cs-CZ")} Kč`
        : "";
  const datum = lead.receivedAtIso
    ? formatCsDateFromIso(lead.receivedAtIso)
    : formatCsDateFromIso(new Date().toISOString().slice(0, 10));

  return {
    jmeno: String(lead.jmeno ?? "").trim() || "—",
    email: String(lead.email ?? "").trim() || "—",
    telefon: String(lead.telefon ?? "").trim() || "—",
    adresa: String(lead.adresa ?? "").trim() || "—",
    typ_poptavky: String(lead.typ ?? "").trim() || "—",
    zprava: String(lead.zprava ?? "").trim() || "—",
    cena: price || "—",
    firma: companyName.trim() || "—",
    datum,
  };
}

function formatCsDateFromIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (m) return `${Number(m[3])}. ${Number(m[2])}. ${m[1]}`;
  return iso.trim() || "—";
}

const VARIABLE_KEYS = [
  "jmeno",
  "email",
  "telefon",
  "adresa",
  "typ_poptavky",
  "zprava",
  "cena",
  "firma",
  "datum",
] as const;

export function applyInquiryTemplateVariables(
  text: string,
  vars: InquiryTemplateVariables
): string {
  let out = text;
  for (const key of VARIABLE_KEYS) {
    const val = vars[key];
    out = out.split(`{${key}}`).join(val);
  }
  return out;
}

export function plainTextToHtmlParagraphs(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .split(/\n/)
    .map((line) =>
      line.trim()
        ? `<p style="margin:0 0 12px;">${line}</p>`
        : `<p style="margin:0 0 8px;">&nbsp;</p>`
    )
    .join("");
}

export function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildInquiryOfferEmailHtml(params: {
  bodyHtmlContent: string;
  organizationName: string;
  logoUrl?: string | null;
  signatureHtml?: string | null;
  phone?: string | null;
  web?: string | null;
  contactEmail?: string | null;
}): string {
  const logo = params.logoUrl?.trim();
  const logoBlock = logo
    ? `<p style="margin:0 0 20px;text-align:center;"><img src="${escapeHtml(logo)}" alt="${escapeHtml(params.organizationName)}" style="max-width:200px;max-height:72px;height:auto;width:auto;" /></p>`
    : `<p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#0f172a;">${escapeHtml(params.organizationName)}</p>`;

  const contactLines: string[] = [];
  if (params.phone?.trim()) contactLines.push(escapeHtml(params.phone.trim()));
  if (params.web?.trim()) {
    const w = params.web.trim();
    const href = w.startsWith("http") ? w : `https://${w}`;
    contactLines.push(
      `<a href="${escapeHtml(href)}" style="color:#c2410c;">${escapeHtml(w)}</a>`
    );
  }
  if (params.contactEmail?.trim()) {
    contactLines.push(
      `<a href="mailto:${escapeHtml(params.contactEmail.trim())}" style="color:#c2410c;">${escapeHtml(params.contactEmail.trim())}</a>`
    );
  }

  const signature =
    params.signatureHtml?.trim() ||
    (contactLines.length
      ? `<p style="margin:0;font-size:14px;color:#334155;line-height:1.5;">${contactLines.join("<br />")}</p>`
      : "");

  return `
<!DOCTYPE html>
<html lang="cs">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:16px 8px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="padding:24px 20px 8px;font-family:system-ui,Segoe UI,sans-serif;">
          ${logoBlock}
        </td></tr>
        <tr><td style="padding:8px 20px 16px;font-family:system-ui,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;">
          ${params.bodyHtmlContent}
        </td></tr>
        <tr><td style="padding:16px 20px 24px;border-top:1px solid #e2e8f0;font-family:system-ui,Segoe UI,sans-serif;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#64748b;">${escapeHtml(params.organizationName)}</p>
          ${signature}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseInquiryOfferTemplateDoc(
  id: string,
  data: Record<string, unknown>
): InquiryOfferTemplate {
  return {
    id,
    companyId: strOrNull(data.companyId) ?? undefined,
    name: String(data.name ?? "").trim() || "Šablona",
    subject: String(data.subject ?? "").trim(),
    bodyText: String(data.bodyText ?? data.body ?? "").trim(),
    active: data.active !== false,
    isDefault: data.isDefault === true,
    sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 0,
    updatedAt: data.updatedAt,
    createdAt: data.createdAt,
  };
}

export function isInquiryWorkflowStatus(s: string): s is InquiryWorkflowStatus {
  return (INQUIRY_WORKFLOW_STATUSES as readonly string[]).includes(s);
}
