/**
 * Parsování JSON z externího endpointu pro import poptávek (Zakázky → Poptávky).
 */

import { extractEstimatedPriceKcFromImportObject } from "@/lib/lead-estimated-price";

export type LeadImportRow = {
  id: string;
  jmeno: string;
  telefon: string;
  email: string;
  adresa: string;
  zprava: string;
  /** Typ / kategorie poptávky z importu (volitelné — záleží na zdroji JSON). */
  typ: string;
  /** Stav / fáze ze zdroje (volitelné). */
  stav?: string;
  /**
   * Datum přijetí / vytvoření ze zdrojového JSON (ISO), pokud ho parser našel.
   * Jinak se doplní při prvním zobrazení do Firestore (`import_lead_overlays.receivedAt`).
   */
  receivedAtIso?: string;
  /** Orientační cena v Kč z importu (pokud ji parser z pole našel a je platná). */
  orientacniCenaKc?: number;
};

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * Bez id ze zdroje: stabilní id z kontaktu (email|telefon), aby se při změně zprávy
 * nebo jména nevytvářel duplicitní záznam při každém importu.
 */
function syntheticIdFromRow(o: Record<string, unknown>): string {
  const email = str(o.email ?? o.mail).trim().toLowerCase();
  const telefon = str(o.telefon ?? o.phone ?? o.tel).trim();
  if (email || telefon) {
    const stable = `${email}|${telefon}`;
    let h = 2166136261;
    for (let i = 0; i < stable.length; i++) {
      h ^= stable.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `synth_${(h >>> 0).toString(36)}`;
  }

  const parts = [
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
/** Pokus o datum z běžných názvů polí v importním JSON. */
function parseUnknownDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) return new Date(parsed);
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) {
      const d = new Date(
        Number(m[3]),
        Number(m[2]) - 1,
        Number(m[1]),
        m[4] != null ? Number(m[4]) : 0,
        m[5] != null ? Number(m[5]) : 0,
        m[6] != null ? Number(m[6]) : 0
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof v === "object" && v !== null && "_seconds" in v) {
    const sec = (v as { _seconds?: unknown })._seconds;
    if (typeof sec === "number" && Number.isFinite(sec)) {
      const d = new Date(sec * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

function receivedAtIsoFromRow(o: Record<string, unknown>): string | undefined {
  const keys = [
    "createdAt",
    "created_at",
    "datum",
    "date",
    "Datum",
    "datumVytvoreni",
    "datum_vytvoreni",
    "datumPrijeti",
    "datum_prijeti",
    "prijato",
    "receivedAt",
    "received_at",
    "timestamp",
    "time",
    "cas",
    "created",
    "importedAt",
    "importDate",
  ];
  for (const k of keys) {
    if (!(k in o)) continue;
    const d = parseUnknownDate(o[k]);
    if (d) return d.toISOString();
  }
  return undefined;
}

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

function stavFromRow(o: Record<string, unknown>): string {
  return str(
    o.stav ??
      o.state ??
      o.status ??
      o.faze ??
      o.phase ??
      o.Stav ??
      ""
  );
}

/** Bez id použijeme syntetické id z údajů řádku (stabilní při opakovaném importu). */
export function normalizeLeadRow(raw: unknown): LeadImportRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const idRaw =
    o.id ??
    o.externalId ??
    o.external_id ??
    o.sourceId ??
    o.source_id ??
    (o as { Id?: unknown }).Id;
  const idFromSource =
    idRaw != null && String(idRaw).trim() !== "" ? String(idRaw).trim() : "";

  const jmeno = str(o.jmeno ?? o.name);
  const telefon = str(o.telefon ?? o.phone ?? o.tel);
  const email = str(o.email ?? o.mail);
  const adresa = str(o.adresa ?? o.address);
  const zprava = str(o.zprava ?? o.message ?? o.zpráva);
  const typ = typFromRow(o);
  const stav = stavFromRow(o);
  const receivedAtIso = receivedAtIsoFromRow(o);
  const orientacniCenaKc = extractEstimatedPriceKcFromImportObject(o);

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
      ...(stav ? { stav } : {}),
      ...(receivedAtIso ? { receivedAtIso } : {}),
      ...(orientacniCenaKc != null ? { orientacniCenaKc } : {}),
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
    ...(stav ? { stav } : {}),
    ...(receivedAtIso ? { receivedAtIso } : {}),
    ...(orientacniCenaKc != null ? { orientacniCenaKc } : {}),
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
