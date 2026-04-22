/**
 * Odesílání dokumentů ze zakázky e-mailem — šablony, proměnné, validace (sdílené klient + server).
 */

export const DOCUMENT_EMAIL_TYPES = [
  "contract",
  "invoice",
  "advance_invoice",
  "received_document",
  "meeting_record",
] as const;

export type DocumentEmailType = (typeof DOCUMENT_EMAIL_TYPES)[number];

export const DOCUMENT_EMAIL_TYPE_LABELS: Record<DocumentEmailType, string> = {
  contract: "Smlouva",
  invoice: "Faktura",
  advance_invoice: "Zálohová faktura",
  received_document: "Přijatý doklad",
  meeting_record: "Zápis ze schůzky",
};

export type DocumentEmailOutboundSettings = {
  autoCcOrganizationEmail?: boolean;
  /** Další příjemci kopie, oddělení čárkou */
  ccEmails?: string | null;
  templates?: Partial<
    Record<
      DocumentEmailType,
      { subject?: string | null; body?: string | null }
    >
  > | null;
};

export type DocumentEmailTemplateVars = {
  nazev_firmy: string;
  jmeno_zakaznika: string;
  cislo_dokladu: string;
  datum: string;
  castka: string;
  odkaz_na_dokument: string;
};

const VAR_KEYS: (keyof DocumentEmailTemplateVars)[] = [
  "nazev_firmy",
  "jmeno_zakaznika",
  "cislo_dokladu",
  "datum",
  "castka",
  "odkaz_na_dokument",
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function defaultEmailTemplate(
  type: DocumentEmailType
): { subject: string; body: string } {
  switch (type) {
    case "contract":
      return {
        subject: "Smlouva — {{cislo_dokladu}}",
        body:
          "Dobrý den,\n\n" +
          "v příloze zasíláme smlouvu č. {{cislo_dokladu}}.\n\n" +
          "Odkaz: {{odkaz_na_dokument}}\n\n" +
          "S pozdravem\n{{nazev_firmy}}",
      };
    case "invoice":
      return {
        subject: "Faktura — {{cislo_dokladu}}",
        body:
          "Dobrý den,\n\n" +
          "v příloze zasíláme fakturu č. {{cislo_dokladu}} (částka {{castka}}).\n\n" +
          "Odkaz: {{odkaz_na_dokument}}\n\n" +
          "S pozdravem\n{{nazev_firmy}}",
      };
    case "advance_invoice":
    case "received_document":
      return {
        subject: "Přijatý doklad — {{cislo_dokladu}}",
        body:
          "Dobrý den,\n\n" +
          "v příloze zasíláme přijatý doklad č. {{cislo_dokladu}}.\n\n" +
          "Odkaz: {{odkaz_na_dokument}}\n\n" +
          "S pozdravem\n{{nazev_firmy}}",
      };
    case "meeting_record":
      return {
        subject: "Zápis ze schůzky — {{cislo_dokladu}}",
        body:
          "Dobrý den,\n\n" +
          "v příloze zasíláme zápis ze schůzky ({{cislo_dokladu}}).\n\n" +
          "S pozdravem\n{{nazev_firmy}}",
      };
    default:
      return {
        subject: "Zálohová faktura — {{cislo_dokladu}}",
        body:
          "Dobrý den,\n\n" +
          "v příloze zasíláme zálohovou fakturu č. {{cislo_dokladu}} (částka {{castka}}).\n\n" +
          "Odkaz: {{odkaz_na_dokument}}\n\n" +
          "S pozdravem\n{{nazev_firmy}}",
      };
  }
}

export function readDocumentEmailOutbound(
  company: Record<string, unknown> | null | undefined
): DocumentEmailOutboundSettings {
  const raw = company?.documentEmailOutbound;
  if (!raw || typeof raw !== "object") return {};
  return raw as DocumentEmailOutboundSettings;
}

/** Sloučí uloženou šablonu organizace s výchozími texty. */
export function getEmailTemplate(
  outbound: DocumentEmailOutboundSettings | null | undefined,
  type: DocumentEmailType
): { subject: string; body: string } {
  const base = defaultEmailTemplate(type);
  const t = outbound?.templates?.[type];
  const subject = String(t?.subject ?? "").trim() || base.subject;
  const body = String(t?.body ?? "").trim() || base.body;
  return { subject, body };
}

/** Nahrazení proměnných pro zobrazení v textových polích (textarea) — hodnoty se neescapují; HTML až při odeslání. */
export function substituteDocumentEmailVariables(
  template: string,
  vars: DocumentEmailTemplateVars
): string {
  let out = template;
  for (const key of VAR_KEYS) {
    const token = `{{${key}}}`;
    const val =
      key === "nazev_firmy" || key === "jmeno_zakaznika" || key === "cislo_dokladu"
        ? String(vars[key] ?? "").replace(/\r?\n/g, " ")
        : String(vars[key] ?? "");
    out = out.split(token).join(val);
  }
  return out;
}

/** Nahrazení s escapováním hodnot (pokud by šablona šla přímo do HTML bez dalšího obalu). */
export function applyDocumentEmailVariables(
  template: string,
  vars: DocumentEmailTemplateVars
): string {
  let out = template;
  for (const key of VAR_KEYS) {
    const token = `{{${key}}}`;
    const val = escapeHtml(String(vars[key] ?? ""));
    out = out.split(token).join(val);
  }
  return out;
}

/** @deprecated použijte substituteDocumentEmailVariables */
export function applyDocumentEmailVariablesPlainSubject(
  template: string,
  vars: DocumentEmailTemplateVars
): string {
  return substituteDocumentEmailVariables(template, vars);
}

export function normalizeEmailBodyToHtml(plain: string): string {
  const trimmed = String(plain ?? "").trim();
  if (!trimmed) return "";
  const esc = escapeHtml(trimmed);
  return `<div style="font-family:system-ui,Segoe UI,sans-serif;font-size:15px;color:#111;line-height:1.5;">${esc
    .split(/\r?\n/)
    .map((p) => (p ? `<p style="margin:0 0 10px;">${p}</p>` : "<br/>"))
    .join("")}</div>`;
}

export function parseCommaSeparatedEmails(raw: string): string[] {
  return String(raw ?? "")
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function isValidEmailAddress(s: string): boolean {
  const t = String(s ?? "").trim();
  return t.length > 0 && t.length <= 320 && EMAIL_RE.test(t);
}

export function hasNonEmptyTextSubjectAndBody(input: {
  subject: string;
  bodyPlain: string;
}): boolean {
  if (!String(input.subject ?? "").trim()) return false;
  if (!String(input.bodyPlain ?? "").trim()) return false;
  return true;
}

export function stripHtmlToPlain(html: string): string {
  return String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
