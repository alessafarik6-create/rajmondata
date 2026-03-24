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
  /** Typ / kategorie poptávky z importu (volitelné — záleží na zdroji JSON). */
  typ: string;
};

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Stabilní syntetické id, pokud zdroj neposílá `id` — stejné údaje ⇒ stejné id. */
function syntheticIdFromRow(o: Record<string, unknown>): string {
  const parts = [
    str(o.email ?? o.mail),
    str(o.telefon ?? o.phone ?? o.tel),
    str(o.jmeno ?? o.name),
    str(o.adresa ?? o.address),
    str(o.zprava ?? o.message ?? o.zpráva),
    str(
      o.typ ??
        o.type ??
        o.typPoptavky ??
        o.typ_poptavky ??
        o.kategorie ??
        o.category ??
        o.productType ??
        o.serviceType
    ),
  ];
  const s = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `synth_${(h >>> 0).toString(36)}`;
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

/**
 * Typ poptávky — mapování běžných názvů polí ze zdrojového JSON.
 */
function typFromRow(o: Record<string, unknown>): string {
  return str(
    o.typ ??
      o.type ??
      o.typPoptavky ??
      o.typ_poptavky ??
      o.kategorie ??
      o.category ??
      o.productType ??
      o.serviceType ??
      o.sluzba ??
      o.služba ??
      o.druh ??
      o.kind
  );
}

/** Bez id použijeme syntetické id z údajů řádku (stabilní při opakovaném importu). */
export function normalizeLeadRow(raw: unknown): LeadImportRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const idRaw = o.id ?? (o as { Id?: unknown }).Id;
  const idFromSource =
    idRaw != null && String(idRaw).trim() !== "" ? String(idRaw).trim() : "";

  const jmeno = str(o.jmeno ?? o.name);
  const telefon = str(o.telefon ?? o.phone ?? o.tel);
  const email = str(o.email ?? o.mail);
  const adresa = str(o.adresa ?? o.address);
  const zprava = str(o.zprava ?? o.message ?? o.zpráva);
  const typ = typFromRow(o);

  if (!idFromSource) {
    const synth = syntheticIdFromRow(o);
    if (!jmeno && !telefon && !email && !adresa && !zprava && !typ) return null;
    return {
      id: synth,
      jmeno,
      telefon,
      email,
      adresa,
      zprava,
      typ,
    };
  }

  return {
    id: idFromSource,
    jmeno,
    telefon,
    email,
    adresa,
    zprava,
    typ,
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
