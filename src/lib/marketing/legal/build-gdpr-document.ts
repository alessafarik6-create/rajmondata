import type { PublicOperatorInfo } from "@/lib/marketing/load-billing-provider-public";
import { LEGAL_GDPR, LEGAL_DPA_SLUG } from "@/lib/marketing/legal-versions";
import { PLATFORM_SUBPROCESSORS } from "@/lib/marketing/subprocessors";
import type { LegalDocumentRender } from "@/lib/marketing/legal/legal-section-types";

export function buildGdprDocument(operator: PublicOperatorInfo): LegalDocumentRender {
  return {
    meta: LEGAL_GDPR,
    disclaimer: "Informační dokument a návrh — k právní revizi.",
    operator,
    sections: [
      {
        heading: "Dvě role RAJMONDATA",
        paragraphs: [
          "1) Správce — zpracování údajů uživatelů registrace, fakturace služby a provoz platformy (viz Zásady ochrany osobních údajů).",
          "2) Zpracovatel — zpracování osobních údajů, které do Služby vloží zákaznická organizace o svých zaměstnancích, zákaznících a obchodních partnerech, a to výhradně dle pokynů správce (organizace).",
        ],
      },
      {
        heading: "Povinnosti organizace jako správce",
        bullets: [
          "Mít právní titul pro zpracování údajů zaměstnanců a zákazníků.",
          "Informovat subjekty údajů dle GDPR.",
          "Uzavřít se Provozovatelem smlouvu o zpracování (DPA), pokud je to vyžadováno.",
        ],
      },
      {
        heading: "Subzpracovatelé Provozovatele",
        bullets: PLATFORM_SUBPROCESSORS.map((s) => `${s.name} (${s.location}): ${s.purpose}`),
      },
      {
        heading: "Návrh zpracovatelské smlouvy",
        paragraphs: [
          `Kompletní návrh smlouvy podle čl. 28 GDPR je na stránce /${LEGAL_DPA_SLUG}. Organizace může požádat o individuální podpis na kontaktním e-mailu provozovatele.`,
        ],
      },
      {
        heading: "Incidenty a audit",
        paragraphs: [
          "Provozovatel informuje organizaci o porušení zabezpečení osobních údajů v rozsahu vyžadovaném GDPR a poskytne přiměřenou součinnost.",
        ],
      },
      {
        heading: "Verze",
        paragraphs: [
          `Verze ${LEGAL_GDPR.version}, účinnost ${LEGAL_GDPR.effectiveDate}, aktualizace ${LEGAL_GDPR.lastUpdated}.`,
        ],
      },
    ],
  };
}
