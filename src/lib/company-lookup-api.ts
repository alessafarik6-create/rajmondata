/**
 * Klient pro POST /api/company-lookup (ARES) — stejný endpoint jako registrace firmy.
 */

export type CompanyLookupAddress = {
  street: string;
  city: string;
  postalCode: string;
  country: string;
  registeredAddressFull: string;
};

export type CompanyLookupResult = {
  ico: string;
  companyName: string;
  dic?: string | null;
  legalForm?: string | null;
  address: CompanyLookupAddress;
  establishedAt?: string | null;
};

/** Kontrolní součet českého IČO (8 číslic). */
export function validateCzechIcoChecksum(ico: string): boolean {
  const digits = ico.split("").map((c) => Number(c));
  if (digits.length !== 8 || digits.some((d) => !Number.isFinite(d))) return false;
  const weights = [8, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, idx) => acc + digits[idx] * w, 0);
  const remainder = sum % 11;
  let check: number;
  if (remainder === 0) check = 1;
  else if (remainder === 1) check = 0;
  else check = 11 - remainder;
  return check === digits[7];
}

export function normalizeCzechIco(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, "");
}

/**
 * @returns chybová zpráva v češtině, nebo null pokud je formát OK (včetně kontrolního součtu).
 */
export function validateCzechIcoInput(raw: string): string | null {
  const ico = normalizeCzechIco(raw);
  if (!/^\d{8}$/.test(ico)) return "IČO musí obsahovat přesně 8 číslic.";
  if (!validateCzechIcoChecksum(ico)) return "Neplatné IČO (kontrolní číslo nesedí).";
  return null;
}

/**
 * Vyhledání subjektu v ARES přes serverové API (stejné jako při registraci).
 * @throws Error s lidsky čitelnou zprávou
 */
export async function lookupCzechCompanyByIco(
  rawIco: string,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<CompanyLookupResult[]> {
  const err = validateCzechIcoInput(rawIco);
  if (err) throw new Error(err);
  const ico = normalizeCzechIco(rawIco);
  const timeoutMs = options?.timeoutMs ?? 13_000;
  const controller = new AbortController();
  const timeoutId =
    typeof window !== "undefined"
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;
  const signal = options?.signal ?? controller.signal;
  try {
    const res = await fetch("/api/company-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ico }),
      signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      results?: CompanyLookupResult[];
    };
    if (!res.ok) {
      throw new Error(data?.error || "Nepodařilo se načíst údaje z ARES.");
    }
    const results = Array.isArray(data?.results) ? data.results : [];
    if (results.length === 0) {
      throw new Error("Firma nebyla nalezena.");
    }
    return results;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Timeout při načítání údajů z ARES.");
    }
    throw e;
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }
}
