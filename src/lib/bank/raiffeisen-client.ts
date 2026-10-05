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
  type RbSyncStage,
} from "@/lib/bank/rb-premium-errors";
import {
  appendQuery,
  clampRbTransactionDateRange,
  logRbAccountSanitized,
  logRbApiError,
  logRbRequest,
  logRbTransactionsError,
  logRbTransactionsRequest,
  logRbTransactionsResponseOk,
  normalizeCurrencyCode,
  normalizeRbAccountNumber,
  sanitizeTransactionsUrlForLog,
} from "@/lib/bank/rb-premium-http";
import { logRbResolvedAccountsUrl } from "@/lib/bank/rb-premium-url";
import {
  mapRbAccountRow,
  mapRbBalanceForCurrency,
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

type HttpsResponse = {
  status: number;
  body: string;
  requestUrl: string;
  requestId: string;
  method: string;
  responseContentType: string | null;
};

type RbRequestOpts = {
  logConfig?: boolean;
  stage?: RbSyncStage;
  logContext?: {
    dateFrom?: string | null;
    dateTo?: string | null;
    accountNumber?: string | null;
    currencyCode?: string | null;
    page?: number | null;
    size?: number | null;
  };
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
  opts?: RbRequestOpts
): Promise<HttpsResponse> {
  if (opts?.logConfig) {
    logRbConfig(cfg.clientId);
    logRbResolvedAccountsUrl();
  }
  const requestUrl = buildRbPremiumRequestUrl(cfg.baseUrl, subpath);
  const requestId = newRequestId();
  logRbRequest({
    method,
    url: requestUrl,
    requestId,
    clientId: cfg.clientId,
    hasCertificate: cfg.p12.length > 0,
    dateFrom: opts?.logContext?.dateFrom,
    dateTo: opts?.logContext?.dateTo,
    accountNumber: opts?.logContext?.accountNumber,
    currencyCode: opts?.logContext?.currencyCode,
    page: opts?.logContext?.page,
    size: opts?.logContext?.size,
  });
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
        const responseContentType = res.headers["content-type"]
          ? String(res.headers["content-type"])
          : null;
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            logRbApiError({
              method,
              url: requestUrl,
              status,
              statusText: res.statusMessage ?? "",
              requestId,
              responseContentType,
              responseBody: body,
            });
          }
          resolve({
            status,
            body,
            requestUrl,
            requestId,
            method,
            responseContentType,
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
  opts?: RbRequestOpts
): Promise<T> {
  const res = await rbHttpsRequest(cfg, subpath, method, opts);
  if (res.status === 204) {
    return {} as T;
  }
  if (res.status >= 400) {
    if (opts?.stage === "transactions") {
      logRbTransactionsError({
        method: res.method,
        url: res.requestUrl,
        status: res.status,
        statusText: "",
        requestId: res.requestId,
        responseContentType: res.responseContentType,
        responseBody: res.body,
      });
    }
    const body = parseRbPremiumErrorBody(res.body);
    throw new RbPremiumApiError({
      httpStatus: res.status,
      requestUrl: res.requestUrl,
      body,
      stage: opts?.stage,
      requestId: res.requestId,
      responseContentType: res.responseContentType,
      source: "upstream",
    });
  }
  try {
    return res.body ? (JSON.parse(res.body) as T) : ({} as T);
  } catch {
    throw new RbPremiumApiError({
      httpStatus: res.status || 502,
      requestUrl: res.requestUrl,
      body: { error_description: "Neplatná JSON odpověď banky." },
      stage: opts?.stage,
      requestId: res.requestId,
      responseContentType: res.responseContentType,
      source: "upstream",
    });
  }
}

function mockAccounts(): RaiffeisenAccountDto[] {
  return [
    {
      externalAccountId: "mock-main-czk",
      rbAccountNumber: "123456789",
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
    const subpath =
      page === 1 ? "/accounts" : appendQuery("/accounts", { page, size: 50 });
    const data = await httpsJson<unknown>(cfg, subpath, "GET", {
      logConfig: page === 1,
      stage: "accounts",
      logContext: { page, size: page === 1 ? null : 50 },
    });
    const parsed = parseRbAccountsPayload(data);
    for (const row of parsed.accounts ?? []) {
      const mapped = mapRbAccountRow(row);
      if (mapped) {
        logRbAccountSanitized(mapped);
        out.push(mapped);
      }
    }
    last = parsed.last === true || (parsed.accounts?.length ?? 0) === 0;
    page += 1;
  }
  return out;
}

/** GET /accounts/{accountNumber}/balance — zůstatek není v seznamu účtů. */
export async function rbFetchAccountBalance(
  cfg: RaiffeisenClientConfig,
  account: Pick<RaiffeisenAccountDto, "rbAccountNumber" | "currency">
): Promise<{ balance: number | null; availableBalance: number | null }> {
  if (isMockMode()) return { balance: 250_000, availableBalance: 248_500 };
  const accountNumber = normalizeRbAccountNumber(account.rbAccountNumber);
  const currencyCode = normalizeCurrencyCode(account.currency) ?? "CZK";
  if (!accountNumber) return { balance: null, availableBalance: null };

  const subpath = `/accounts/${encodeURIComponent(accountNumber)}/balance`;
  const data = await httpsJson<unknown>(cfg, subpath, "GET", {
    stage: "accounts",
    logContext: { accountNumber, currencyCode },
  });
  return mapRbBalanceForCurrency(data, currencyCode);
}

export async function rbFetchTransactions(
  cfg: RaiffeisenClientConfig,
  account: Pick<RaiffeisenAccountDto, "rbAccountNumber" | "externalAccountId" | "currency">,
  opts?: { dateFrom?: string; dateTo?: string }
): Promise<RaiffeisenTransactionDto[]> {
  if (isMockMode()) return mockTransactions(account.externalAccountId);

  logRbAccountSanitized(account);
  const accountNumber = normalizeRbAccountNumber(account.rbAccountNumber);
  const currencyCode = normalizeCurrencyCode(account.currency);
  if (!accountNumber || !currencyCode) {
    throw new RbPremiumApiError({
      httpStatus: 400,
      requestUrl: buildRbPremiumRequestUrl(cfg.baseUrl, "/accounts/.../transactions"),
      body: {
        error: "LOCAL_VALIDATION",
        error_description: "Chybí platné accountNumber nebo currencyCode (nepoužívat accountId).",
      },
      stage: "transactions",
      source: "local",
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { dateFrom, dateTo } = clampRbTransactionDateRange(
    opts?.dateFrom?.slice(0, 10) ?? today,
    opts?.dateTo?.slice(0, 10) ?? today
  );

  const all: RaiffeisenTransactionDto[] = [];
  let page = 1;
  let lastPage = false;

  while (!lastPage && page <= 500) {
    const pathBase = `/accounts/${encodeURIComponent(accountNumber)}/${encodeURIComponent(currencyCode)}/transactions`;
    const subpath = appendQuery(pathBase, {
      from: dateFrom,
      to: dateTo,
      page: page > 1 ? page : undefined,
    });
    const fullUrl = buildRbPremiumRequestUrl(cfg.baseUrl, subpath);
    logRbTransactionsRequest({
      method: "GET",
      url: fullUrl,
      requestId: newRequestId(),
      accountNumber,
      currencyCode,
      dateFrom,
      dateTo,
    });
    console.info("[RB TRANSACTIONS URL]", sanitizeTransactionsUrlForLog(fullUrl));

    const data = await httpsJson<unknown>(cfg, subpath, "GET", {
      stage: "transactions",
      logContext: { dateFrom, dateTo, accountNumber, currencyCode, page },
    });
    logRbTransactionsResponseOk(data, 200);
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

export type RbTestTransactionsResult = {
  ok: boolean;
  httpStatus: number;
  requestUrl: string;
  requestId?: string;
  transactionCount: number;
  contentType?: string | null;
  message: string;
};

export async function rbTestTransactions(cfg: RaiffeisenClientConfig): Promise<RbTestTransactionsResult> {
  const accounts = await rbFetchAccounts(cfg);
  const first = accounts.find((a) => normalizeRbAccountNumber(a.rbAccountNumber));
  if (!first) {
    return {
      ok: false,
      httpStatus: 0,
      requestUrl: "",
      transactionCount: 0,
      message: "Žádný účet s platným accountNumber pro test transakcí.",
    };
  }
  const today = new Date().toISOString().split("T")[0];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  const dateFrom = d.toISOString().slice(0, 10);
  try {
    const txns = await rbFetchTransactions(cfg, first, { dateFrom, dateTo: today });
    return {
      ok: true,
      httpStatus: 200,
      requestUrl: buildRbPremiumRequestUrl(cfg.baseUrl, "/accounts/{n}/{ccy}/transactions"),
      transactionCount: txns.length,
      message: `Transakce OK — ${txns.length} položek (30 dní).`,
    };
  } catch (e) {
    if (e instanceof RbPremiumApiError) {
      return {
        ok: false,
        httpStatus: e.httpStatus,
        requestUrl: e.requestUrl,
        requestId: e.requestId,
        transactionCount: 0,
        contentType: e.responseContentType,
        message: e.userMessage,
      };
    }
    throw e;
  }
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
    const res = await rbHttpsRequest(cfg, "/accounts", "GET", {
      logConfig: true,
      stage: "accounts",
    });
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
        message: `Raiffeisenbank připojena – nalezeno ${accountsFound} účtů.`,
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
      stage: "accounts",
      requestId: res.requestId,
      responseContentType: res.responseContentType,
      source: "upstream",
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
