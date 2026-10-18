import { marketingUnsubscribeUrl } from "@/lib/platform-org-campaigns/marketing-unsubscribe";

const ORANGE = "#ea580c";

export type OrgCampaignEmailInput = {
  organizationName: string;
  title: string;
  shortDescription: string;
  bodyHtml?: string | null;
  imageUrl?: string | null;
  campaignUrl: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  consultationUrl?: string | null;
  customHtml?: string | null;
  unsubscribeUrl?: string | null;
  isTest?: boolean;
};

export function buildOrgCampaignEmailHtml(input: OrgCampaignEmailInput): string {
  if (input.customHtml?.trim() && !input.bodyHtml) {
    return wrapEmailShell(input.customHtml.trim(), input);
  }

  const bodyInner =
    input.bodyHtml?.trim() ||
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#334155;">${escapeHtml(input.shortDescription)}</p>`;

  const imgBlock = input.imageUrl
    ? `<tr><td style="padding:0 24px 16px;"><img src="${escapeAttr(input.imageUrl)}" alt="" width="552" style="max-width:100%;height:auto;border-radius:8px;display:block;" /></td></tr>`
    : "";

  const primaryCta = input.ctaUrl
    ? buttonRow(input.ctaLabel || "Otevřít v RAJMONDATA", input.ctaUrl)
    : buttonRow("Otevřít v RAJMONDATA", input.campaignUrl);

  const consultCta = input.consultationUrl
    ? buttonRow("Domluvit bezplatnou konzultaci", input.consultationUrl, true)
    : "";

  const content = `
${imgBlock}
<tr><td style="padding:8px 24px 0;font-size:22px;font-weight:700;color:#0f172a;line-height:1.3;">${escapeHtml(input.title)}</td></tr>
<tr><td style="padding:12px 24px 8px;font-size:15px;line-height:1.6;color:#334155;">${bodyInner}</td></tr>
${primaryCta}
${consultCta}
<tr><td style="padding:16px 24px 8px;font-size:13px;line-height:1.5;color:#64748b;">Organizace: <strong>${escapeHtml(input.organizationName)}</strong></td></tr>`;

  return wrapEmailShell(content, input);
}

function buttonRow(label: string, href: string, secondary = false): string {
  const bg = secondary ? "#fff" : ORANGE;
  const color = secondary ? ORANGE : "#ffffff";
  const border = secondary ? `2px solid ${ORANGE}` : "none";
  return `<tr><td style="padding:12px 24px;">
  <a href="${escapeAttr(href)}" style="display:inline-block;padding:14px 28px;background:${bg};color:${color};font-size:16px;font-weight:700;text-decoration:none;border-radius:8px;border:${border};">${escapeHtml(label)}</a>
</td></tr>`;
}

function wrapEmailShell(innerRows: string, input: OrgCampaignEmailInput): string {
  const unsub = input.unsubscribeUrl
    ? `<p style="margin:12px 0 0;font-size:11px;color:#94a3b8;"><a href="${escapeAttr(input.unsubscribeUrl)}" style="color:#64748b;">Odhlásit marketingové e-maily RAJMONDATA</a></p>`
    : "";
  const testBanner = input.isTest
    ? `<tr><td style="padding:8px 24px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:600;text-align:center;">TEST — tento e-mail není součástí ostré kampaně</td></tr>`
    : "";

  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
<tr><td style="padding:20px 24px;background:#0f172a;text-align:center;">
<span style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:0.02em;">RAJMON<span style="color:${ORANGE};">DATA</span></span>
</td></tr>
${testBanner}
<tr><td style="padding:20px 24px 8px;font-size:14px;color:#64748b;">Dobrý den,</td></tr>
${innerRows}
<tr><td style="padding:24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;">
<p style="margin:0;">RAJMONDATA · firemní portál pro zakázky, finance a tým</p>
<p style="margin:8px 0 0;">Tento e-mail byl odeslán ze systému RAJMONDATA.cz.</p>
${unsub}
</td></tr>
</table></td></tr></table></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

export function buildOrgCampaignEmailForRecipient(
  input: Omit<OrgCampaignEmailInput, "unsubscribeUrl"> & {
    organizationId: string;
    appBaseUrl: string;
    emailMarketing?: boolean;
    isTest?: boolean;
  }
): string {
  const unsub =
    input.emailMarketing !== false && !input.isTest
      ? marketingUnsubscribeUrl(input.organizationId, input.appBaseUrl)
      : null;
  return buildOrgCampaignEmailHtml({
    ...input,
    unsubscribeUrl: unsub,
    isTest: input.isTest,
  });
}
