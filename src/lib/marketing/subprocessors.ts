/**
 * Subzpracovatelé odvozené ze skutečné architektury projektu (bez tajných klíčů).
 * Aktualizujte po změně integrací.
 */

export type SubprocessorRow = {
  name: string;
  purpose: string;
  location: string;
  legalBasisNote?: string;
};

export const PLATFORM_SUBPROCESSORS: SubprocessorRow[] = [
  {
    name: "Google Firebase / Google Cloud (Authentication, Firestore, Cloud Storage)",
    purpose:
      "Provoz účtů, databáze aplikace, ukládání souborů organizací a technická infrastruktura platformy.",
    location: "EU / USA (dle konfigurace projektu Firebase a Google Cloud)",
    legalBasisNote:
      "Standardní smluvní doložky a podmínky Google; konkrétní region závisí na nastavení projektu.",
  },
  {
    name: "OpenAI",
    purpose:
      "Volitelné AI funkce (návrhy textů, transkripce hlasu, vyhledávání v dokumentaci — dle aktivních modulů).",
    location: "USA / další regiony dle poskytovatele",
    legalBasisNote: "Předávání pouze tam, kde organizace AI funkce používá a vloží relevantní podklady.",
  },
  {
    name: "Resend",
    purpose: "Transakční e-maily (reset hesla, odesílání dokumentů z portálu, systémová upozornění).",
    location: "USA / EU dle Resend",
  },
  {
    name: "Vercel (nebo ekvivalentní hosting Next.js aplikace)",
    purpose: "Hostování webové aplikace, edge/serverless běh API.",
    location: "EU / USA dle regionu nasazení",
  },
];

/** Volitelné — pouze pokud je v produkci skutečně použito. */
export const OPTIONAL_SUBPROCESSORS: SubprocessorRow[] = [
  {
    name: "ARES / veřejné registry (lookup IČO při registraci)",
    purpose: "Doplnění veřejných údajů o firmě z registru.",
    location: "Česká republika",
  },
];
