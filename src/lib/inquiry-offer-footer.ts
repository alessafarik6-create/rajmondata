/**
 * Firemní patička / podpis e-mailové nabídky (organizace + autor).
 */

import type { InquiryEmailIdentity } from "@/lib/inquiry-offer-email";
import { resolveOrganizationDisplayName, resolveInquiryReplyToEmail } from "@/lib/inquiry-offer-email";

export type InquiryOfferAuthorSnapshot = {
  uid: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  photoUrl: string | null;
  initials: string | null;
};

export type InquiryOfferFooterData = {
  companyName: string;
  ico: string | null;
  addressMultiline: string | null;
  contactEmail: string | null;
  phone: string | null;
  web: string | null;
  logoUrl: string | null;
  author: InquiryOfferAuthorSnapshot | null;
};

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}

export function buildCompanyRegisteredAddress(company: Record<string, unknown>): string | null {
  const streetAndNumber = company.companyAddressStreetAndNumber;
  const city = company.companyAddressCity;
  const postalCode = company.companyAddressPostalCode;
  const country = company.companyAddressCountry;

  const structured =
    streetAndNumber || city || postalCode || country
      ? [
          streetAndNumber ? String(streetAndNumber).trim() : "",
          [postalCode ? String(postalCode).trim() : "", city ? String(city).trim() : ""]
            .filter(Boolean)
            .join(" "),
          country ? String(country).trim() : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  if (structured) return structured;

  const legacy = String(
    company.registeredOfficeAddress ??
      company.registeredOffice ??
      company.address ??
      company.sidlo ??
      ""
  ).trim();
  return legacy || null;
}

export function authorInitialsFromName(name: string | null | undefined): string | null {
  const n = String(name ?? "").trim();
  if (!n) return null;
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

/** @deprecated Preferujte resolveInquiryOfferAuthor na serveru (fotka ze zaměstnance + Storage). */
export function inquiryOfferAuthorFromUserDoc(
  uid: string,
  userDoc: Record<string, unknown> | null | undefined
): InquiryOfferAuthorSnapshot {
  const d = userDoc ?? {};
  const displayName = strOrNull(d.displayName) ?? strOrNull(d.name);
  const photoFields = [
    "photoURL",
    "photoUrl",
    "avatarUrl",
    "profilePhotoUrl",
    "profileImageUrl",
    "imageUrl",
    "employeePhotoUrl",
    "userPhotoUrl",
    "profileImage",
  ] as const;
  let photoUrl: string | null = null;
  for (const key of photoFields) {
    const raw = strOrNull(d[key]);
    if (raw && (raw.startsWith("http://") || raw.startsWith("https://"))) {
      photoUrl = raw;
      break;
    }
  }
  return {
    uid,
    displayName,
    email: strOrNull(d.email),
    phone: strOrNull(d.phone) ?? strOrNull(d.phoneNumber),
    jobTitle: strOrNull(d.jobTitle) ?? strOrNull(d.position),
    photoUrl,
    initials: authorInitialsFromName(displayName),
  };
}

export function buildInquiryOfferFooterData(params: {
  company: Record<string, unknown>;
  identity: InquiryEmailIdentity;
  author?: InquiryOfferAuthorSnapshot | null;
}): InquiryOfferFooterData {
  const companyName = resolveOrganizationDisplayName(params.company, params.identity);
  const replyTo = resolveInquiryReplyToEmail(params.identity, params.company);
  const contactEmail =
    replyTo ||
    params.identity.contactEmail?.trim() ||
    strOrNull(params.company.email);
  const phone =
    params.identity.phone?.trim() || strOrNull(params.company.phone);
  const web = params.identity.web?.trim() || strOrNull(params.company.web);

  return {
    companyName,
    ico: strOrNull(params.company.ico),
    addressMultiline: buildCompanyRegisteredAddress(params.company),
    contactEmail,
    phone,
    web,
    logoUrl: strOrNull(params.company.organizationLogoUrl),
    author: params.author ?? null,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addressToHtmlLines(address: string | null): string {
  if (!address?.trim()) return "";
  return escapeHtml(address.trim()).replace(/\n/g, "<br />");
}

/** HTML patičky vložené do e-mailu (bez RAJMONDATA branding). */
export function buildInquiryOfferFooterHtml(footer: InquiryOfferFooterData): string {
  const lines: string[] = [];
  const author = footer.author;

  if (author?.photoUrl) {
    lines.push(
      `<td style="vertical-align:top;padding-right:12px;width:56px;">
        <img src="${escapeHtml(author.photoUrl)}" alt="" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:50%;object-fit:cover;border:1px solid #e2e8f0;" />
      </td>`
    );
  } else if (author?.initials) {
    lines.push(
      `<td style="vertical-align:top;padding-right:12px;width:56px;">
        <div style="width:48px;height:48px;border-radius:50%;background:#f1f5f9;border:1px solid #e2e8f0;text-align:center;line-height:48px;font-size:15px;font-weight:600;color:#475569;">${escapeHtml(author.initials)}</div>
      </td>`
    );
  }

  const companyLines: string[] = [];
  companyLines.push(
    `<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#0f172a;">${escapeHtml(footer.companyName)}</p>`
  );
  if (footer.ico) {
    companyLines.push(
      `<p style="margin:0 0 4px;font-size:13px;color:#334155;">IČO: ${escapeHtml(footer.ico)}</p>`
    );
  }
  const addrHtml = addressToHtmlLines(footer.addressMultiline);
  if (addrHtml) {
    companyLines.push(
      `<p style="margin:0 0 6px;font-size:13px;color:#334155;line-height:1.45;">${addrHtml}</p>`
    );
  }
  if (footer.contactEmail) {
    companyLines.push(
      `<p style="margin:0 0 2px;font-size:13px;color:#334155;"><a href="mailto:${escapeHtml(footer.contactEmail)}" style="color:#c2410c;text-decoration:none;">${escapeHtml(footer.contactEmail)}</a></p>`
    );
  }
  if (footer.phone) {
    companyLines.push(
      `<p style="margin:0 0 2px;font-size:13px;color:#334155;">${escapeHtml(footer.phone)}</p>`
    );
  }
  if (footer.web) {
    const w = footer.web.trim();
    const href = w.startsWith("http") ? w : `https://${w}`;
    companyLines.push(
      `<p style="margin:0 0 2px;font-size:13px;color:#334155;"><a href="${escapeHtml(href)}" style="color:#c2410c;text-decoration:none;">${escapeHtml(w)}</a></p>`
    );
  }

  if (author?.displayName || author?.email || author?.phone) {
    companyLines.push(`<p style="margin:12px 0 4px;font-size:12px;color:#64748b;">—</p>`);
    if (author.displayName) {
      companyLines.push(
        `<p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(author.displayName)}</p>`
      );
    }
    if (author.jobTitle) {
      companyLines.push(
        `<p style="margin:0 0 4px;font-size:13px;color:#475569;">${escapeHtml(author.jobTitle)}</p>`
      );
    }
    if (author.email) {
      companyLines.push(
        `<p style="margin:0 0 2px;font-size:13px;color:#334155;"><a href="mailto:${escapeHtml(author.email)}" style="color:#c2410c;text-decoration:none;">${escapeHtml(author.email)}</a></p>`
      );
    }
    if (author.phone) {
      companyLines.push(
        `<p style="margin:0;font-size:13px;color:#334155;">${escapeHtml(author.phone)}</p>`
      );
    }
  }

  const authorCell =
    lines.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${lines.join("")}<td style="vertical-align:top;">${companyLines.join("")}</td></tr></table>`
      : companyLines.join("");

  const logoBlock = footer.logoUrl
    ? `<p style="margin:0 0 12px;"><img src="${escapeHtml(footer.logoUrl)}" alt="${escapeHtml(footer.companyName)}" style="max-width:180px;max-height:64px;height:auto;width:auto;" /></p>`
    : "";

  return `${logoBlock}${authorCell}`;
}
