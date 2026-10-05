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
  name?: string | null;
}): void {
  const num = String(acc.rbAccountNumber ?? "").replace(/\D/g, "");
  const cur = normalizeCurrencyCode(acc.currency);
  console.info("[RB ACCOUNT]", {
    name: acc.name ?? null,
    accountNumberMasked: num ? accountNumberSuffix(num) : null,
    currencyCode: cur ?? null,
    hasAccountNumber: num.length > 0,
    externalAccountIdSuffix: acc.externalAccountId
      ? String(acc.externalAccountId).slice(-4)
      : null,
  });
}

export function logRbAccountRawFields(row: Record<string, unknown>): void {
  console.info("[RB ACCOUNT]", {
    availableFields: Object.keys(row).sort(),
    hasAccountNumber: row.accountNumber != null,
    hasMainCurrency: row.mainCurrency != null,
    hasAccountId: row.accountId != null,
  });
}

export function maskTransactionsUrl(url: string): string {
  return url.replace(/\/accounts\/(\d{4,10})\//, "/accounts/***$1/".replace("***", "***"));
}

export function sanitizeTransactionsUrlForLog(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    const parts = u.pathname.split("/");
    const accIdx = parts.findIndex((p) => p === "accounts");
    if (accIdx >= 0 && parts[accIdx + 1] && /^\d+$/.test(parts[accIdx + 1])) {
      const digits = parts[accIdx + 1];
      parts[accIdx + 1] = `***${digits.slice(-4)}`;
      u.pathname = parts.join("/");
    }
    return u.toString();
  } catch {
    return fullUrl.slice(0, 120);
  }
}

/** RB: `from` nesmí být starší než 90 dní (chyba DT01). */
export const RB_MAX_TRANSACTION_HISTORY_DAYS = 89;

export function clampRbTransactionDateRange(
  dateFrom: string,
  dateTo: string
): { dateFrom: string; dateTo: string } {
  const to = assertDateOnly("dateTo", dateTo);
  let from = assertDateOnly("dateFrom", dateFrom);
  const anchor = new Date(`${to}T12:00:00Z`);
  const minFrom = new Date(anchor);
  minFrom.setUTCDate(minFrom.getUTCDate() - RB_MAX_TRANSACTION_HISTORY_DAYS);
  const minFromStr = minFrom.toISOString().slice(0, 10);
  if (from < minFromStr) {
    console.info("[RB TRANSACTIONS RANGE] clamped dateFrom", { from, minFromStr, dateTo: to });
    from = minFromStr;
  }
  console.info("[RB TRANSACTIONS RANGE]", { dateFrom: from, dateTo: to });
  return { dateFrom: from, dateTo: to };
}

export function logRbTransactionsRequest(input: {
  method: string;
  url: string;
  requestId: string;
  accountNumber: string;
  currencyCode: string;
  dateFrom: string;
  dateTo: string;
}): void {
  console.info("[RB TRANSACTIONS REQUEST]", {
    method: input.method,
    url: sanitizeTransactionsUrlForLog(input.url),
    accountNumberMasked: accountNumberSuffix(input.accountNumber),
    currencyCode: input.currencyCode,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    requestId: input.requestId,
  });
}

export function logRbTransactionsError(input: RbHttpRawResponse): void {
  const { sanitizedBody } = readRbHttpResponse(input);
  console.error("[RB TRANSACTIONS ERROR]", {
    status: input.status,
    statusText: input.statusText || null,
    requestId: input.requestId,
    contentType: input.responseContentType,
    responseBody: sanitizedBody,
  });
}

export function logRbTransactionsResponseOk(data: unknown, status: number): void {
  const keys =
    data && typeof data === "object" && !Array.isArray(data)
      ? Object.keys(data as object)
      : [];
  const obj = data as { transactions?: unknown[]; lastPage?: boolean };
  const count = Array.isArray(obj.transactions) ? obj.transactions.length : 0;
  console.info("[RB TRANSACTIONS RESPONSE]", {
    status,
    topLevelKeys: keys,
    transactionCount: count,
    hasPagination: keys.includes("lastPage"),
    lastPage: obj.lastPage ?? null,
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
