import type { LeadImportRow } from "@/lib/lead-import-parse";

/** Jednoduchý hash pro párování bez stabilního id z importu. */
function compositeKeyHash(lead: LeadImportRow): string {
  const s = `${lead.email}|${lead.telefon}|${lead.jmeno}|${lead.adresa}|${lead.zprava}|${String(lead.typ ?? "")}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * ID dokumentu ve Firestore pro stav poptávky — musí být stabilní mezi importy.
 * Preferuje `id` z importu; jinak deterministický hash z kontaktních údajů.
 */
export function stableImportLeadDocumentId(lead: LeadImportRow): string {
  const raw = String(lead.id || "").trim();
  if (raw) {
    return raw.replace(/[/\\]/g, "_").slice(0, 700);
  }
  return `cmp_${compositeKeyHash(lead)}`;
}
