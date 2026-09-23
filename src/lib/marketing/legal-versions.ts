/**
 * Verze veřejných právních dokumentů.
 * Při změně textu zvyšte verzi a ponechte záznam v historii (git / archiv).
 */

export type LegalDocumentMeta = {
  slug: string;
  title: string;
  version: string;
  effectiveDate: string;
  lastUpdated: string;
};

export const LEGAL_TERMS: LegalDocumentMeta = {
  slug: "obchodni-podminky",
  title: "Obchodní podmínky",
  version: "1.0",
  effectiveDate: "2026-09-17",
  lastUpdated: "2026-09-17",
};

export const LEGAL_PRIVACY: LegalDocumentMeta = {
  slug: "ochrana-osobnich-udaju",
  title: "Zásady ochrany osobních údajů",
  version: "1.0",
  effectiveDate: "2026-09-17",
  lastUpdated: "2026-09-17",
};

/** Legacy URL — přesměrování na /ochrana-osobnich-udaju (next.config redirects). */
export const LEGACY_GDPR_SLUG = "gdpr";

export const LEGAL_COOKIES: LegalDocumentMeta = {
  slug: "cookies",
  title: "Cookies a lokální úložiště",
  version: "1.0",
  effectiveDate: "2026-09-17",
  lastUpdated: "2026-09-17",
};

export const LEGAL_DPA_SLUG = "zpracovatelska-smlouva";

/** Pro registraci — akceptované dokumenty musí odpovídat těmto verzím. */
export const REGISTRATION_REQUIRED_LEGAL = [LEGAL_TERMS, LEGAL_PRIVACY] as const;
