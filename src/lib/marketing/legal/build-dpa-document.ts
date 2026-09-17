import type { PublicOperatorInfo } from "@/lib/marketing/load-billing-provider-public";
import { LEGAL_GDPR } from "@/lib/marketing/legal-versions";
import { PLATFORM_SUBPROCESSORS } from "@/lib/marketing/subprocessors";
import type { LegalDocumentRender } from "@/lib/marketing/legal/legal-section-types";

/** DPA jako samostatný právní dokument — meta verze navázaná na GDPR balíček. */
const DPA_META = {
  slug: "zpracovatelska-smlouva",
  title: "Smlouva o zpracování osobních údajů",
  version: LEGAL_GDPR.version,
  effectiveDate: LEGAL_GDPR.effectiveDate,
  lastUpdated: LEGAL_GDPR.lastUpdated,
};

export function buildDpaDocument(operator: PublicOperatorInfo): LegalDocumentRender {
  return {
    meta: DPA_META,
    disclaimer:
      "Návrh smlouvy o zpracování osobních údajů (DPA) podle čl. 28 GDPR — k individuálnímu doplnění a podpisu s advokátem.",
    operator,
    sections: [
      {
        heading: "Smluvní strany",
        paragraphs: [
          `Správce: zákaznická organizace používající RAJMONDATA.`,
          `Zpracovatel: ${operator.companyName}, IČO ${operator.ico}.`,
        ],
      },
      {
        heading: "Předmět a doba zpracování",
        paragraphs: [
          "Zpracovatel zpracovává osobní údaje jménem Správce po dobu trvání smlouvy o Službě a v rozsahu pokynů Správce.",
        ],
      },
      {
        heading: "Povaha, účel, typy údajů a subjekty",
        bullets: [
          "Účel: provoz cloudové aplikace pro řízení firmy Správce.",
          "Typy: identifikační, kontaktní, pracovněprávní, obchodní, komunikační, technické.",
          "Subjekty: zaměstnanci Správce, zákazníci Správce, kontaktní osoby.",
        ],
      },
      {
        heading: "Pokyny Správce a mlčenlivost",
        paragraphs: [
          "Zpracovatel postupuje pouze dle dokumentovaných pokynů Správce. Personál je vázán mlčenlivostí.",
        ],
      },
      {
        heading: "Bezpečnostní opatření",
        paragraphs: [
          "Řízení přístupu, šifrování přenosu, logování, oddělení tenantů, pravidelné aktualizace. Podrobnosti lze doplnit v příloze technických opatření.",
        ],
      },
      {
        heading: "Subzpracovatelé",
        bullets: PLATFORM_SUBPROCESSORS.map((s) => `${s.name} — ${s.purpose}`),
        paragraphs: [
          "Správce uděluje obecný souhlas s využitím uvedených subzpracovatelů; o plánované změně bude Správce informován s možností námitky v přiměřené lhůtě.",
        ],
      },
      {
        heading: "Práva subjektů, incidenty, audit",
        bullets: [
          "Zpracovatel pomůže Správci reagovat na žádosti subjektů údajů.",
          "Oznámení porušení zabezpečení bez zbytečného odkladu.",
          "Přiměřená součinnost při auditu (dle dohody, s ohledem na obchodní tajemství třetích stran).",
        ],
      },
      {
        heading: "Ukončení — vrácení a vámaz",
        paragraphs: [
          "Po ukončení smlouvy Zpracovatel data vymaže nebo vrátí dle volby Správce v dostupných exportních formátech, pokud zákon nevyžaduje delší uchování.",
        ],
      },
    ],
  };
}
