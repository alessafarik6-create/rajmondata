/** Bezpečně zobrazitelná odpověď RB (OAuth / IBM API Connect). */
export type RbPremiumErrorBody = {
  error?: string;
  error_description?: string;
  message?: string;
  moreInformation?: string;
};

export function parseRbPremiumErrorBody(raw: string): RbPremiumErrorBody {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return {};
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      error: safeRbErrorToken(j.error ?? j.errorCode ?? j.code),
      error_description: safeRbErrorDescription(
        j.error_description ?? j.errorDescription ?? j.message ?? j.moreInformation
      ),
      message: safeRbErrorDescription(j.message),
      moreInformation: safeRbErrorDescription(j.moreInformation),
    };
  } catch {
    return {
      error_description: safeRbErrorDescription(trimmed.slice(0, 500)),
    };
  }
}

function safeRbErrorToken(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  if (!s || s.length > 120) return undefined;
  if (/secret|password|certificate|private/i.test(s)) return undefined;
  return s.replace(/[\r\n<>]/g, " ").slice(0, 120);
}

export function safeRbErrorDescription(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  const cleaned = s.replace(/[\r\n<>]/g, " ").slice(0, 600);
  if (/password|private key|\.p12|pfx|Bearer\s+[A-Za-z0-9._-]+/i.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

export function rbPremiumTestUserMessage(
  httpStatus: number,
  body: RbPremiumErrorBody
): string {
  const desc = body.error_description ?? body.message ?? body.moreInformation;
  const err = body.error;

  if (httpStatus === 200) {
    return "Připojení k Raiffeisenbank je funkční.";
  }
  if (httpStatus === 400) {
    const base = "Raiffeisenbank odmítla parametry požadavku.";
    if (process.env.NODE_ENV === "development" && desc) return `${base} ${desc}`;
    return desc && process.env.NODE_ENV !== "production" ? `${base} ${desc}` : base;
  }
  if (httpStatus === 401) {
    const base = "Bankovní certifikát není platný nebo nebyl použit.";
    if (process.env.NODE_ENV === "development" && desc) return `${base} ${desc}`;
    return base;
  }
  if (httpStatus === 403) {
    const base = "Certifikát nemá oprávnění k bankovnímu účtu nebo službě.";
    if (process.env.NODE_ENV === "development" && (err || desc)) {
      return [base, err, desc].filter(Boolean).join(" ");
    }
    return base;
  }
  if (httpStatus === 404) {
    return "Chybný endpoint bankovního API (404). Ověřte RAIFFEISENBANK_API_BASE_URL.";
  }
  if (httpStatus === 429) {
    return "Byl překročen limit volání Raiffeisenbank.";
  }
  if (httpStatus >= 500 && httpStatus <= 599) {
    const base = "Bankovní synchronizace se nezdařila.";
    if (process.env.NODE_ENV === "development" && desc) return `${base} ${desc}`;
    return base;
  }
  if (httpStatus === 0) {
    return desc ?? "Nepodařilo se navázat spojení s bankou.";
  }
  const base = `Bankovní API vrátilo HTTP ${httpStatus}.`;
  return desc ? `${base} ${desc}` : base;
}

/** Řádek pro UI: HTTP status + kód chyby RB. */
export function formatRbPremiumTestDisplay(httpStatus: number, body: RbPremiumErrorBody): string {
  if (httpStatus === 200) {
    return "Raiffeisenbank API odpovědělo HTTP 200 – připojení je funkční.";
  }
  const err = body.error?.trim();
  const head = err
    ? `Raiffeisenbank API odpovědělo HTTP ${httpStatus} – ${err}`
    : `Raiffeisenbank API odpovědělo HTTP ${httpStatus}`;
  const desc = body.error_description ?? body.message ?? body.moreInformation;
  return desc ? `${head}. ${desc}` : head;
}

export type RbSyncStage = "accounts" | "transactions" | "connection";

export class RbPremiumApiError extends Error {
  readonly httpStatus: number;
  readonly requestUrl: string;
  readonly rbError?: string;
  readonly rbErrorDescription?: string;
  readonly userMessage: string;
  readonly display: string;
  readonly stage?: RbSyncStage;
  readonly requestId?: string;
  readonly responseContentType?: string | null;
  readonly source: "upstream" | "local";

  constructor(input: {
    httpStatus: number;
    requestUrl: string;
    body?: RbPremiumErrorBody;
    userMessage?: string;
    stage?: RbSyncStage;
    requestId?: string;
    responseContentType?: string | null;
    source?: "upstream" | "local";
  }) {
    const body = input.body ?? {};
    const userMessage =
      input.userMessage ?? rbPremiumTestUserMessage(input.httpStatus, body);
    super(userMessage);
    this.name = "RbPremiumApiError";
    this.httpStatus = input.httpStatus;
    this.requestUrl = input.requestUrl;
    this.rbError = body.error;
    this.rbErrorDescription =
      body.error_description ?? body.message ?? body.moreInformation;
    this.userMessage = userMessage;
    this.display = formatRbPremiumTestDisplay(input.httpStatus, body);
    this.stage = input.stage;
    this.requestId = input.requestId;
    this.responseContentType = input.responseContentType ?? null;
    this.source = input.source ?? "upstream";
  }
}
