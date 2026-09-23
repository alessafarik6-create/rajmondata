import type { PublicOperatorInfo } from "@/lib/marketing/load-billing-provider-public";
import { LEGAL_DPA_SLUG, LEGAL_PRIVACY } from "@/lib/marketing/legal-versions";
import { OPTIONAL_SUBPROCESSORS, PLATFORM_SUBPROCESSORS } from "@/lib/marketing/subprocessors";
import type { LegalDocumentRender } from "@/lib/marketing/legal/legal-section-types";

export function buildPrivacyDocument(operator: PublicOperatorInfo): LegalDocumentRender {
  const subList = [...PLATFORM_SUBPROCESSORS, ...OPTIONAL_SUBPROCESSORS]
    .map((s) => `${s.name} — ${s.purpose}`)
    .join("; ");

  return {
    meta: LEGAL_PRIVACY,
    operator,
    sections: [
      {
        heading: "Správce",
        paragraphs: [
          `${operator.companyName}, IČO ${operator.ico}${operator.dic ? `, DIČ ${operator.dic}` : ""}, sídlo: ${operator.address || "dle registrace"}. Kontakt: ${operator.email || "viz web"}.`,
        ],
      },
      {
        heading: "Rozsah těchto zásad",
        paragraphs: [
          "Tento dokument popisuje zpracování osobních údajů v souvislosti s platformou RAJMONDATA podle nařízení GDPR a souvisejících předpisů.",
          "Zpracování údajů uživatelů registrace, fakturace služby a provozu platformy probíhá v roli správce (provozovatel).",
          "Zpracování údajů, které do systému vkládá zákaznická organizace o svých zaměstnancích, zákaznících a obchodních partnerech, probíhá v roli zpracovatele výhradně dle pokynů správce (organizace).",
        ],
      },
      {
        heading: "Kategorie údajů a účely (správce)",
        bullets: [
          "Identifikační a kontaktní údaje (jméno, e-mail, telefon, firma, IČO) — registrace a komunikace.",
          "Přihlašovací údaje — autentizace (heslo u Firebase Auth; neukládáme ho v čitelné podobě).",
          "Fakturační údaje — plnění smlouvy a účetnictví provozovatele.",
          "Technické logy a bezpečnostní záznamy — ochrana Služby.",
          "Obsah podpory a ticketů — vyřízení požadavků.",
        ],
      },
      {
        heading: "Právní tituly",
        paragraphs: [
          "Plnění smlouvy, oprávněný zájem (bezpečnost, zlepšování Služby v anonymizované podobě), plnění právních povinností a souhlas tam, kde je vyžadován (např. marketing mimo smlouvu).",
        ],
      },
      {
        heading: "Příjemci a zpracovatelé",
        paragraphs: [subList],
      },
      {
        heading: "Povinnosti organizace jako správce údajů",
        bullets: [
          "Mít právní titul pro zpracování údajů zaměstnanců a zákazníků.",
          "Informovat subjekty údajů podle GDPR.",
          "Uzavřít se Provozovatelem smlouvu o zpracování (DPA), pokud je to vyžadováno.",
        ],
      },
      {
        heading: "Subzpracovatelé provozovatele",
        bullets: PLATFORM_SUBPROCESSORS.map((s) => `${s.name} (${s.location}): ${s.purpose}`),
      },
      {
        heading: "Smlouva o zpracování osobních údajů (DPA)",
        paragraphs: [
          `Text smlouvy podle čl. 28 GDPR je k dispozici na stránce /${LEGAL_DPA_SLUG}. Organizace může požádat o individuální podpis na kontaktním e-mailu provozovatele.`,
        ],
      },
      {
        heading: "Doba uchování",
        paragraphs: [
          "Po dobu trvání smlouvy a následně dle zákonných archivačních lhůt nebo do výmazu po ukončení služby, pokud není nutnější delší uchování ze zákona.",
        ],
      },
      {
        heading: "Předávání mimo EU/EHP",
        paragraphs: [
          "Někteří poskytovatelé (např. cloud, e-mail, AI) mohou zpracovávat údaje mimo EHP. V takovém případě se spoléháme na standardní smluvní doložky a bezpečnostní opatření poskytovatele.",
        ],
      },
      {
        heading: "Práva subjektů",
        bullets: [
          "Přístup, oprava, výmaz, omezení, námitka, přenositelnost (je-li použitelná).",
          "Odvolání souhlasu u zpracování založeného na souhlasu.",
          "Stížnost u ÚOOÚ (www.uoou.cz).",
        ],
      },
      {
        heading: "Zabezpečení a incidenty",
        paragraphs: [
          "Používáme řízení přístupu, šifrované přenosy (HTTPS), oddělení dat organizací (multi-tenant) a pravidelnou aktualizaci aplikace. Absolutní bezpečnost nelze garantovat.",
          "Provozovatel informuje organizaci o porušení zabezpečení osobních údajů v rozsahu vyžadovaném GDPR a poskytne přiměřenou součinnost.",
        ],
      },
      {
        heading: "Automatizované rozhodování",
        paragraphs: [
          "AI funkce v portálu zákazníka neprovádějí automatizované rozhodování s právními účinky vůči subjektům údajů bez účasti člověka; výstupy jsou podpůrné.",
        ],
      },
      {
        heading: "Cookies",
        paragraphs: ["Podrobnosti viz stránka /cookies."],
      },
      {
        heading: "Verze dokumentu",
        paragraphs: [
          `Verze ${LEGAL_PRIVACY.version}, účinnost od ${LEGAL_PRIVACY.effectiveDate}, aktualizace ${LEGAL_PRIVACY.lastUpdated}.`,
        ],
      },
    ],
  };
}
