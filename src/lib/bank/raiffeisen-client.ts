import https from "node:https";
import type { BankAccountDoc } from "@/lib/bank/types";

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

function isMockMode(): boolean {
  return String(process.env.RAIFFEISENBANK_MOCK ?? "").trim() === "1";
}

function defaultBaseUrl(): string {
  return (
    String(process.env.RAIFFEISENBANK_API_BASE_URL ?? "").trim() ||
    "https://api.rb.cz/premium"
  ).replace(/\/$/, "");
}

function httpsJson<T>(
  cfg: RaiffeisenClientConfig,
  path: string,
  method: "GET" | "POST" = "GET"
): Promise<T> {
  const url = new URL(`${cfg.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
  const agent = new https.Agent({
    pfx: cfg.p12,
    passphrase: cfg.p12Password,
    rejectUnauthorized: true,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        agent,
        headers: {
          Accept: "application/json",
          "X-Client-Id": cfg.clientId,
        },
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(mapRbHttpError(res.statusCode, body)));
            return;
          }
          try {
            resolve(body ? (JSON.parse(body) as T) : ({} as T));
          } catch {
            reject(new Error("Banka vrátila neplatnou odpověď."));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Časový limit bankovního API vypršel."));
    });
    req.on("error", (err) => {
      reject(new Error(humanizeTlsError(err)));
    });
    req.end();
  });
}

function mapRbHttpError(status: number, _body: string): string {
  if (status === 401 || status === 403) {
    return "Neplatné ClientID nebo certifikát. Ověřte přihlašovací údaje k Raiffeisenbank Premium API.";
  }
  if (status === 429) {
    return "Banka dočasně omezila počet požadavků. Zkuste synchronizaci později.";
  }
  if (status >= 500) {
    return "Bankovní služba je dočasně nedostupná.";
  }
  return "Bankovní API vrátilo chybu.";
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

export async function rbTestConnection(cfg: RaiffeisenClientConfig): Promise<{ ok: true }> {
  await rbFetchAccounts(cfg);
  return { ok: true };
}

export function buildRaiffeisenClientConfig(input: {
  clientId: string;
  p12: Buffer;
  p12Password: string;
}): RaiffeisenClientConfig {
  return {
    baseUrl: defaultBaseUrl(),
    clientId: input.clientId.trim(),
    p12: input.p12,
    p12Password: input.p12Password,
  };
}

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
