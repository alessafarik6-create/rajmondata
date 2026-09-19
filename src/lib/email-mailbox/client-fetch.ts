/** Bezpečné parsování odpovědi e-mail API (i prázdné tělo / HTML chyba). */
export type EmailApiClientBase = {
  ok?: boolean;
  success?: boolean;
  message?: string;
  error?: string;
};

export type EmailApiParsed<T> = EmailApiClientBase & T;

function emailApiFailure(message: string, error: string): EmailApiClientBase {
  return {
    ok: false,
    success: false,
    error,
    message,
  };
}

export async function parseEmailApiResponse<T = Record<string, unknown>>(
  res: Response
): Promise<EmailApiParsed<T>> {
  const text = await res.text();
  if (!text.trim()) {
    return {
      ...emailApiFailure(
        res.ok ? "Server vrátil prázdnou odpověď." : `Požadavek selhal (HTTP ${res.status}).`,
        res.ok ? "Prázdná odpověď serveru." : `HTTP ${res.status}`
      ),
    } as EmailApiParsed<T>;
  }
  try {
    const parsed = JSON.parse(text) as EmailApiParsed<T>;
    return parsed;
  } catch {
    return {
      ...emailApiFailure(
        `Neplatná odpověď serveru (HTTP ${res.status}).`,
        "INVALID_JSON"
      ),
    } as EmailApiParsed<T>;
  }
}
