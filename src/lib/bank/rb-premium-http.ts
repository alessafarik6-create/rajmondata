import { parseRbPremiumErrorBody, safeRbErrorDescription } from "@/lib/bank/rb-premium-errors";

export type RbHttpRawResponse = {
  method: string;
  url: string;
  status: number;
  statusText: string;
  requestId: string;
  responseContentType: string | null;
  responseBody: string;
};

export function sanitizeResponseBodyForLog(raw: string, max = 1200): string {
  let s = String(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  s = s.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  s = s.replace(/("password"\s*:\s*")[^"]+"/gi, '$1[REDACTED]"');
  return s.slice(0, max);
}

export function readRbHttpResponse(input: RbHttpRawResponse) {
  const parsed = parseRbPremiumErrorBody(input.responseBody);
  return {
    ...input,
    sanitizedBody: sanitizeResponseBodyForLog(input.responseBody),
    parsed,
  };
}

export function logRbRequest(input: {
  method: string;
  url: string;
  requestId: string;
  clientId: string;
  hasCertificate: boolean;
  dateFrom?: string | null;
  dateTo?: string | null;
  accountNumber?: string | null;
  currencyCode?: string | null;
  page?: number | null;
  size?: number | null;
}): void {
  const suffix = input.clientId.trim().slice(-4);
  console.info("[RB REQUEST]", {
    method: input.method,
    url: input.url,
    requestId: input.requestId,
    hasClientId: Boolean(input.clientId.trim()),
    clientIdSuffix: suffix || "????",
    hasCertificate: input.hasCertificate,
    dateFrom: input.dateFrom ?? undefined,
    dateTo: input.dateTo ?? undefined,
    accountNumber: input.accountNumber ?? undefined,
    currencyCode: input.currencyCode ?? undefined,
    page: input.page ?? undefined,
    size: input.size ?? undefined,
  });
}

export function logRbApiError(input: RbHttpRawResponse): void {
  const { sanitizedBody, parsed } = readRbHttpResponse(input);
  console.error("[RB API ERROR]", {
    method: input.method,
    url: input.url,
    status: input.status,
    statusText: input.statusText || null,
    requestId: input.requestId,
    responseContentType: input.responseContentType,
    responseBody: sanitizedBody,
    error: parsed.error ?? null,
    error_description: parsed.error_description ?? parsed.message ?? null,
  });
}

export function accountNumberSuffix(accountNumber: string): string {
  const digits = String(accountNumber ?? "").replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `…${digits.slice(-4)}`;
}

export function logRbAccountSanitized(acc: {
  rbAccountNumber?: string | null;
  currency?: string | null;
  externalAccountId?: string;
}): void {
  const num = String(acc.rbAccountNumber ?? "").replace(/\D/g, "");
  const cur = normalizeCurrencyCode(acc.currency);
  console.info("[RB ACCOUNT]", {
    hasAccountNumber: num.length > 0,
    accountNumberSuffix: num ? accountNumberSuffix(num) : null,
    currencyCode: cur ?? null,
    externalAccountIdSuffix: acc.externalAccountId
      ? String(acc.externalAccountId).slice(-4)
      : null,
  });
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateOnly(label: string, value: string): string {
  const d = String(value ?? "").trim().slice(0, 10);
  if (!DATE_ONLY.test(d)) {
    throw new Error(`${label} musí být YYYY-MM-DD, obdrženo: ${String(value).slice(0, 32)}`);
  }
  return d;
}

export function normalizeCurrencyCode(raw: unknown): string | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (!/^[A-Z]{3}$/.test(s)) return null;
  return s;
}

export function normalizeRbAccountNumber(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits || digits.length > 10) return null;
  return digits;
}

export function appendQuery(subpath: string, params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  const qs = q.toString();
  return qs ? `${subpath}?${qs}` : subpath;
}

export function problemJsonHint(contentType: string | null, body: string): string | undefined {
  if (!contentType?.toLowerCase().includes("problem+json")) return undefined;
  return safeRbErrorDescription(body.slice(0, 400));
}
