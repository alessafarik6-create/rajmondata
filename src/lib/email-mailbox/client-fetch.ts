/** Bezpečné parsování odpovědi e-mail API (i prázdné tělo / HTML chyba). */
export async function parseEmailApiResponse<T = Record<string, unknown>>(
  res: Response
): Promise<T & { ok?: boolean; success?: boolean; message?: string; error?: string }> {
  const text = await res.text();
  if (!text.trim()) {
    return {
      ok: false,
      success: false,
      error: res.ok ? "Prázdná odpověď serveru." : `HTTP ${res.status}`,
      message: res.ok
        ? "Server vrátil prázdnou odpověď."
        : `Požadavek selhal (HTTP ${res.status}).`,
    } as T & { ok: false; error: string; message: string };
  }
  try {
    return JSON.parse(text) as T & { ok?: boolean; success?: boolean };
  } catch {
    return {
      ok: false,
      success: false,
      error: "INVALID_JSON",
      message: `Neplatná odpověď serveru (HTTP ${res.status}).`,
    } as T & { ok: false; error: string; message: string };
  }
}
