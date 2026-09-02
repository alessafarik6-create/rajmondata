/**
 * Bezpečné parsování odpovědi fetch — nepadá na plain text (např. Request Entity Too Large).
 */

export type ParsedFetchJson<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number; rawPreview?: string };

export async function parseFetchJsonResponse<T = Record<string, unknown>>(
  response: Response
): Promise<ParsedFetchJson<T>> {
  const contentType = response.headers.get("content-type") ?? "";
  const status = response.status;

  if (contentType.includes("application/json")) {
    try {
      const data = (await response.json()) as T;
      return { ok: true, data, status };
    } catch {
      return {
        ok: false,
        status,
        error: userMessageForHttpStatus(status),
      };
    }
  }

  const text = (await response.text()).trim();
  if (process.env.NODE_ENV === "development") {
    console.warn("[parseFetchJsonResponse] non-JSON response", {
      status,
      preview: text.slice(0, 200),
    });
  }

  if (status === 413 || /request entity too large/i.test(text)) {
    return {
      ok: false,
      status: 413,
      error: "Soubor je příliš velký pro přímé nahrání přes server. Zkuste menší PDF nebo kontaktujte administrátora.",
      rawPreview: text.slice(0, 120),
    };
  }

  if (status >= 500) {
    return {
      ok: false,
      status,
      error: "Server dočasně neodpovídá. Zkuste to prosím znovu.",
      rawPreview: text.slice(0, 120),
    };
  }

  return {
    ok: false,
    status,
    error: userMessageForHttpStatus(status),
    rawPreview: text.slice(0, 120),
  };
}

function userMessageForHttpStatus(status: number): string {
  if (status === 401) return "Nejste přihlášeni. Obnovte stránku a zkuste znovu.";
  if (status === 403) return "Nemáte oprávnění k této operaci.";
  if (status === 413) return "Soubor je příliš velký.";
  if (status === 422) return "Soubor se nepodařilo zpracovat.";
  if (status >= 500) return "Chyba serveru. Zkuste to prosím znovu.";
  return "Požadavek se nezdařil.";
}

export function extractApiError(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const msg = data.message ?? data.error;
  if (typeof msg === "string" && msg.trim()) return msg.trim();
  return null;
}
