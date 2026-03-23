/**
 * Parsování JSON z externího endpointu pro import poptávek (Zakázky → Poptávky).
 */

export type LeadImportRow = {
  id: string;
  jmeno: string;
  telefon: string;
  email: string;
  adresa: string;
  zprava: string;
};

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Vytáhne pole záznamů z kořenového JSON (pole nebo { items|data|results|poptavky|leads }). */
export function extractLeadRecords(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const key of ["items", "data", "results", "poptavky", "leads", "records"]) {
      const v = o[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/** id je povinné — bez něj řádek přeskočíme. */
export function normalizeLeadRow(raw: unknown): LeadImportRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const idRaw = o.id ?? (o as { Id?: unknown }).Id;
  if (idRaw == null || String(idRaw).trim() === "") return null;

  return {
    id: String(idRaw).trim(),
    jmeno: str(o.jmeno ?? o.name),
    telefon: str(o.telefon ?? o.phone ?? o.tel),
    email: str(o.email ?? o.mail),
    adresa: str(o.adresa ?? o.address),
    zprava: str(o.zprava ?? o.message ?? o.zpráva),
  };
}

export function parseLeadImportPayload(json: unknown): LeadImportRow[] {
  const records = extractLeadRecords(json);
  const out: LeadImportRow[] = [];
  for (const r of records) {
    const row = normalizeLeadRow(r);
    if (row) out.push(row);
  }
  return out;
}
