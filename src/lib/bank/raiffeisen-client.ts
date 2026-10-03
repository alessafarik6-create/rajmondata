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

export type RaiffeisenClientConfig = {
  baseUrl: string;
  clientId: string;
  p12: Buffer;
  p12Password: string;
};

export type RaiffeisenAccountDto = {
  externalAccountId: string;
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
};

function isMockMode(): boolean {
  return String(process.env.RAIFFEISENBANK_MOCK ?? "").trim() === "1";
}

function newRequestId(): string {
  return crypto.randomUUID();
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
  method: "GET" | "POST" = "GET"
): Promise<HttpsResponse> {
  const requestUrl = buildRbPremiumRequestUrl(cfg.baseUrl, subpath);
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
          "X-IBM-Client-Id": cfg.clientId,
          "X-Request-Id": newRequestId(),
        },
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            requestUrl,
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
  method: "GET" | "POST" = "GET"
): Promise<T> {
  const res = await rbHttpsRequest(cfg, subpath, method);
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
  const data = await httpsJson<{ accounts?: RaiffeisenAccountDto[] }>(cfg, "/accounts");
  const list = Array.isArray(data.accounts) ? data.accounts : [];
  return list.map((a) => ({
    externalAccountId: String(a.externalAccountId ?? "").trim(),
    accountNumber: a.accountNumber ?? null,
    iban: a.iban ?? null,
    currency: String(a.currency ?? "CZK").toUpperCase(),
    name: a.name ?? null,
    balance: a.balance ?? null,
    availableBalance: a.availableBalance ?? null,
  }));
}

export async function rbFetchTransactions(
  cfg: RaiffeisenClientConfig,
  externalAccountId: string,
  opts?: { dateFrom?: string; dateTo?: string }
): Promise<RaiffeisenTransactionDto[]> {
  if (isMockMode()) return mockTransactions(externalAccountId);
  const q = new URLSearchParams();
  if (opts?.dateFrom) q.set("dateFrom", opts.dateFrom);
  if (opts?.dateTo) q.set("dateTo", opts.dateTo);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  const data = await httpsJson<{ transactions?: RaiffeisenTransactionDto[] }>(
    cfg,
    `/accounts/${encodeURIComponent(externalAccountId)}/transactions${suffix}`
  );
  return Array.isArray(data.transactions) ? data.transactions : [];
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
    };
  }

  const requestUrl = buildRbPremiumRequestUrl(cfg.baseUrl, "/accounts");

  try {
    const res = await rbHttpsRequest(cfg, "/accounts", "GET");
    const body = parseRbPremiumErrorBody(res.body);

    if (res.status === 200) {
      logRbTest({
        requestUrl: res.requestUrl,
        httpStatus: 200,
        clientId: cfg.clientId,
      });
      return {
        ok: true,
        httpStatus: 200,
        message: rbPremiumTestUserMessage(200, body),
        display: formatRbPremiumTestDisplay(200, body),
        requestUrl: res.requestUrl,
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
