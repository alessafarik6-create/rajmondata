import crypto from "node:crypto";
import https from "node:https";
import type { BankAccountDoc } from "@/lib/bank/types";
import { maskClientId } from "@/lib/bank/secrets-crypto";
import {
  buildRbPremiumRequestUrl,
  resolveRaiffeisenApiOrigin,
} from "@/lib/bank/rb-premium-url";
import {
  formatRbPremiumTestDisplay,
  parseRbPremiumErrorBody,
  RbPremiumApiError,
  rbPremiumTestUserMessage,
} from "@/lib/bank/rb-premium-errors";
import {
  mapRbAccountRow,
  mapRbTransactionRow,
  parseRbAccountsPayload,
  parseRbTransactionsPayload,
} from "@/lib/bank/rb-response-map";

export type RaiffeisenClientConfig = {
  baseUrl: string;
  clientId: string;
  p12: Buffer;
  p12Password: string;
};

export type RaiffeisenAccountDto = {
  externalAccountId: string;
  /** Číslo účtu bez prefixu — path param RB API */
  rbAccountNumber?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  currency: string;
  name?: string | null;
  balance?: number | null;
  availableBalance?: number | null;
};

export type RaiffeisenTransactionDto = {
  externalTransactionId?: string | null;
  bookingDate: string;
  valueDate?: string | null;
  amount: number;
  currency: string;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  variableSymbol?: string | null;
  constantSymbol?: string | null;
  specificSymbol?: string | null;
  message?: string | null;
  reference?: string | null;
};

export type RbTestConnectionResult = {
  ok: true;
  httpStatus: 200;
  message: string;
  display: string;
  requestUrl: string;
  accountsFound: number;
};

function isMockMode(): boolean {
  return String(process.env.RAIFFEISENBANK_MOCK ?? "").trim() === "1";
}

function newRequestId(): string {
  const raw = crypto.randomUUID().replace(/[^a-zA-Z0-9\-_:]/g, "");
  return raw.slice(0, 60);
}

function logRbConfig(clientId: string): void {
  const suffix = clientId.trim().slice(-4);
  console.info("[RB CONFIG]", {
    clientIdConfigured: Boolean(clientId.trim()),
    clientIdSuffix: suffix || "????",
    apiOrigin: resolveRaiffeisenApiOrigin(),
    mock: isMockMode(),
  });
}

function sanitizeErrorBodyForLog(body: string, max = 800): string {
  return String(body ?? "")
    .replace(/[\r\n]+/g, " ")
    .slice(0, max);
}

function logRbApiError(input: {
  endpoint: string;
  status: number;
  statusText?: string;
  requestId?: string;
  responseBody: string;
}): void {
  const parsed = parseRbPremiumErrorBody(input.responseBody);
  console.error("[RB API ERROR]", {
    endpoint: input.endpoint,
    status: input.status,
    statusText: input.statusText ?? null,
    requestId: input.requestId ?? null,
    error: parsed.error ?? null,
    error_description: parsed.error_description ?? parsed.message ?? null,
    responseBody: sanitizeErrorBodyForLog(input.responseBody),
  });
}

type HttpsResponse = {
  status: number;
  body: string;
  requestUrl: string;
};

function logRbTest(input: {
  requestUrl: string;
  httpStatus: number;
  clientId: string;
  error?: string;
  errorDescription?: string;
  tlsMessage?: string;
}): void {
  console.info("[RB TEST] URL", input.requestUrl);
  console.info("[RB TEST] HTTP status", input.httpStatus);
  console.info("[RB TEST] clientId", maskClientId(input.clientId));
  if (input.tlsMessage) {
    console.info("[RB TEST] error", input.tlsMessage);
    return;
  }
  if (input.error) console.info("[RB TEST] error", input.error);
  if (input.errorDescription) {
    console.info("[RB TEST] error_description", input.errorDescription);
  }
}

function humanizeTlsError(err: Error): string {
  const msg = String(err.message ?? "");
  if (/bad decrypt|mac verify failure/i.test(msg)) {
    return "Heslo certifikátu .p12 není správné.";
  }
  if (/certificate|pfx|expired/i.test(msg)) {
    return "Certifikát .p12 je neplatný nebo expirovaný.";
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
    return "Nepodařilo se navázat spojení s bankou.";
  }
  return "Chyba spojení s bankou.";
}

function rbHttpsRequest(
  cfg: RaiffeisenClientConfig,
  subpath: string,
  method: "GET" | "POST" = "GET",
  opts?: { logConfig?: boolean }
): Promise<HttpsResponse & { requestId: string }> {
  if (opts?.logConfig) logRbConfig(cfg.clientId);
  const requestUrl = buildRbPremiumRequestUrl(cfg.baseUrl, subpath);
  const requestId = newRequestId();
  const agent = new https.Agent({
    pfx: cfg.p12,
    passphrase: cfg.p12Password,
    rejectUnauthorized: true,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(requestUrl);
    const req = https.request(
      url,
      {
        method,
        agent,
        headers: {
          Accept: "application/json",
          "X-IBM-Client-Id": cfg.clientId.trim(),
          "X-Request-Id": requestId,
        },
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            logRbApiError({
              endpoint: requestUrl,
              status,
              statusText: res.statusMessage,
              requestId,
              responseBody: body,
            });
          }
          resolve({
            status,
            body,
            requestUrl,
            requestId,
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Časový limit bankovního API vypršel."));
    });
    req.on("error", (err) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });
    req.end();
  });
}

async function httpsJson<T>(
  cfg: RaiffeisenClientConfig,
  subpath: string,
  method: "GET" | "POST" = "GET",
  opts?: { logConfig?: boolean }
): Promise<T> {
  const res = await rbHttpsRequest(cfg, subpath, method, opts);
  if (res.status >= 400) {
    const body = parseRbPremiumErrorBody(res.body);
    throw new RbPremiumApiError({
      httpStatus: res.status,
      requestUrl: res.requestUrl,
      body,
    });
  }
  try {
    return res.body ? (JSON.parse(res.body) as T) : ({} as T);
  } catch {
    throw new RbPremiumApiError({
      httpStatus: res.status || 502,
      requestUrl: res.requestUrl,
      body: { error_description: "Neplatná JSON odpověď banky." },
    });
  }
}

function mockAccounts(): RaiffeisenAccountDto[] {
  return [
    {
      externalAccountId: "mock-main-czk",
      accountNumber: "123456789/5500",
      iban: "CZ6508000000192000145399",
      currency: "CZK",
      name: "Hlavní účet (demo)",
      balance: 250_000,
      availableBalance: 248_500,
    },
  ];
}

function mockTransactions(accountId: string): RaiffeisenTransactionDto[] {
  const today = new Date().toISOString().split("T")[0];
  return [
    {
      externalTransactionId: `mock-in-${accountId}-1`,
      bookingDate: today,
      amount: 180_000,
      currency: "CZK",
      counterpartyName: "Demo zákazník s.r.o.",
      variableSymbol: "2026015",
      message: "Úhrada faktury",
    },
    {
      externalTransactionId: `mock-out-${accountId}-1`,
      bookingDate: today,
      amount: -4_500,
      currency: "CZK",
      counterpartyName: "Operátor s.r.o.",
      message: "Telefon",
    },
  ];
}

/** Načte účty z RB Premium API (nebo demo režim). */
export async function rbFetchAccounts(cfg: RaiffeisenClientConfig): Promise<RaiffeisenAccountDto[]> {
  if (isMockMode()) return mockAccounts();

  const out: RaiffeisenAccountDto[] = [];
  let page = 1;
  let last = false;
  while (!last && page <= 50) {
    const data = await httpsJson<unknown>(
      cfg,
      `/accounts?page=${page}&size=50`,
      "GET",
      { logConfig: page === 1 }
    );
    const parsed = parseRbAccountsPayload(data);
    for (const row of parsed.accounts ?? []) {
      const mapped = mapRbAccountRow(row);
      if (mapped) out.push(mapped);
    }
    last = parsed.last === true || (parsed.accounts?.length ?? 0) === 0;
    page += 1;
  }
  return out;
}

function rbTransactionFromIso(dateOnly: string, endOfDay: boolean): string {
  return endOfDay ? `${dateOnly}T23:59:59.999Z` : `${dateOnly}T00:00:00.0Z`;
}

export async function rbFetchTransactions(
  cfg: RaiffeisenClientConfig,
  account: Pick<RaiffeisenAccountDto, "rbAccountNumber" | "externalAccountId" | "currency">,
  opts?: { dateFrom?: string; dateTo?: string }
): Promise<RaiffeisenTransactionDto[]> {
  if (isMockMode()) return mockTransactions(account.externalAccountId);

  const accountNumber = String(account.rbAccountNumber ?? account.externalAccountId ?? "")
    .replace(/\D/g, "")
    .slice(0, 10);
  const currencyCode = String(account.currency ?? "CZK").toUpperCase().slice(0, 3);
  if (!accountNumber || !currencyCode) {
    throw new RbPremiumApiError({
      httpStatus: 400,
      requestUrl: buildRbPremiumRequestUrl(cfg.baseUrl, "/accounts/.../transactions"),
      body: { error_description: "Chybí číslo účtu nebo měna pro RB API." },
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = opts?.dateFrom?.slice(0, 10) ?? today;
  const dateTo = opts?.dateTo?.slice(0, 10) ?? today;
  console.info("[RB SYNC]", { dateFrom, dateTo, accountNumber, currencyCode });

  const all: RaiffeisenTransactionDto[] = [];
  let page = 1;
  let lastPage = false;

  while (!lastPage && page <= 500) {
    const q = new URLSearchParams({
      from: rbTransactionFromIso(dateFrom, false),
      to: rbTransactionFromIso(dateTo, true),
      page: String(page),
    });
    const path = `/accounts/${encodeURIComponent(accountNumber)}/${encodeURIComponent(currencyCode)}/transactions?${q}`;
    const data = await httpsJson<unknown>(cfg, path, "GET");
    const parsed = parseRbTransactionsPayload(data);
    for (const row of parsed.transactions) {
      const mapped = mapRbTransactionRow(row, currencyCode);
      if (mapped) all.push(mapped);
    }
    lastPage = parsed.lastPage;
    if (parsed.transactions.length === 0) break;
    page += 1;
  }

  return all;
}

/**
 * Test připojení: GET /rbcz/premium/api/accounts (mTLS + X-IBM-Client-Id).
 */
export async function rbTestConnection(cfg: RaiffeisenClientConfig): Promise<RbTestConnectionResult> {
  if (isMockMode()) {
    const requestUrl = buildRbPremiumRequestUrl(cfg.baseUrl, "/accounts");
    return {
      ok: true,
      httpStatus: 200,
      message: "Připojení k Raiffeisenbank je funkční (mock režim).",
      display: formatRbPremiumTestDisplay(200, {}),
      requestUrl,
      accountsFound: 1,
    };
  }

  const requestUrl = buildRbPremiumRequestUrl(cfg.baseUrl, "/accounts");

  try {
    const res = await rbHttpsRequest(cfg, "/accounts?page=1&size=15", "GET", { logConfig: true });
    const body = parseRbPremiumErrorBody(res.body);

    if (res.status === 200) {
      let parsedData: unknown = {};
      try {
        parsedData = JSON.parse(res.body || "{}");
      } catch {
        parsedData = {};
      }
      const parsed = parseRbAccountsPayload(parsedData);
      const accountsFound = parsed.accounts?.length ?? 0;
      logRbTest({
        requestUrl: res.requestUrl,
        httpStatus: 200,
        clientId: cfg.clientId,
      });
      return {
        ok: true,
        httpStatus: 200,
        message: `Připojeno k Raiffeisenbank. Nalezeno účtů: ${accountsFound}.`,
        display: formatRbPremiumTestDisplay(200, body),
        requestUrl: res.requestUrl,
        accountsFound,
      };
    }

    logRbTest({
      requestUrl: res.requestUrl,
      httpStatus: res.status,
      clientId: cfg.clientId,
      error: body.error,
      errorDescription: body.error_description ?? body.message ?? body.moreInformation,
    });

    throw new RbPremiumApiError({
      httpStatus: res.status,
      requestUrl: res.requestUrl,
      body,
    });
  } catch (e) {
    if (e instanceof RbPremiumApiError) throw e;
    const tlsMsg = e instanceof Error ? humanizeTlsError(e) : "Chyba spojení s bankou.";
    logRbTest({
      requestUrl,
      httpStatus: 0,
      clientId: cfg.clientId,
      tlsMessage: tlsMsg,
    });
    throw new RbPremiumApiError({
      httpStatus: 0,
      requestUrl,
      body: { error_description: tlsMsg },
      userMessage: tlsMsg,
    });
  }
}

export function buildRaiffeisenClientConfig(input: {
  clientId: string;
  p12: Buffer;
  p12Password: string;
}): RaiffeisenClientConfig {
  return {
    baseUrl: resolveRaiffeisenApiOrigin(),
    clientId: input.clientId.trim(),
    p12: input.p12,
    p12Password: input.p12Password,
  };
}

export { RbPremiumApiError } from "@/lib/bank/rb-premium-errors";

export function serializeAccountPreview(row: BankAccountDoc) {
  return {
    id: row.externalAccountId,
    accountNumber: row.accountNumber ?? null,
    iban: row.iban ? maskIban(row.iban) : null,
    currency: row.currency,
    name: row.name ?? null,
    balance: row.balance ?? null,
    availableBalance: row.availableBalance ?? null,
    isActive: row.isActive !== false,
  };
}

export function maskIban(iban: string): string {
  const s = String(iban ?? "").replace(/\s/g, "");
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}
