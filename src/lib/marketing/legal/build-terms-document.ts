import type { PublicOperatorInfo } from "@/lib/marketing/load-billing-provider-public";
import { LEGAL_TERMS } from "@/lib/marketing/legal-versions";
import type { LegalDocumentRender } from "@/lib/marketing/legal/legal-section-types";

const DRAFT_NOTE =
  "Tento text je návrh obchodních podmínek připravený k odborné právní revizi. Před použitím vůči zákazníkům jej prosím nechte zkontrolovat advokátem.";

function operatorBlock(o: PublicOperatorInfo): string {
  const lines = [
    o.companyName,
    o.ico ? `IČO: ${o.ico}` : "",
    o.dic ? `DIČ: ${o.dic}` : "",
    o.address,
    o.email ? `E-mail: ${o.email}` : "",
    o.phone ? `Telefon: ${o.phone}` : "",
  ].filter(Boolean);
  return lines.join(", ");
}

export function buildTermsDocument(operator: PublicOperatorInfo): LegalDocumentRender {
  const liabilityNote =
    operator.liabilityCapNote ||
    "Finanční limit odpovědnosti provozovatele (pokud bude sjednán) bude uveden v individuální smlouvě nebo objednávce; do jeho sjednání platí níže uvedená pravidla v rozsahu dovoleném kogentními právními předpisy.";

  return {
    meta: LEGAL_TERMS,
    disclaimer: DRAFT_NOTE,
    operator,
    sections: [
      {
        heading: "1. Provozovatel a definice",
        paragraphs: [
          `Provozovatelem online služby RAJMONDATA (dále „Služba“) je ${operatorBlock(operator)} (dále „Provozovatel“).`,
          "Služba je softwarová platforma (SaaS) poskytovaná formou vzdáleného přístupu prostřednictvím webového rozhraní.",
          "Zákazník je podnikající právnická nebo fyzická osoba, která uzavřela smlouvu o používání Služby.",
          "Organizace je firemní tenant v Službě vytvořený Zákazníkem; Uživatel je fyzická osoba přístupující do Služby v rámci Organizace.",
        ],
      },
      {
        heading: "2. Předmět a uzavření smlouvy",
        paragraphs: [
          "Předmětem je poskytnutí licence k používání Služby v rozsahu aktivních modulů a tarifu dle aktuálního ceníku Provozovatele.",
          "Smlouva vzniká registrací Organizace a akceptací těchto podmínek, případně písemnou objednávkou, nebo aktivací licence superadministrátorem platformy — dle procesu uvedeného na webu.",
        ],
      },
      {
        heading: "3. Uživatelský účet a Organizace",
        bullets: [
          "Zákazník odpovídá za správnost registračních údajů a za přidělení rolí Uživatelům.",
          "Přístupové údaje jsou důvěrné; Zákazník zajistí, aby je neužívaly neoprávněné osoby.",
          "Provozovatel může účet dočasně omezit při podezření na zneužití nebo porušení podmínek.",
        ],
      },
      {
        heading: "4. Licence a právo užití",
        paragraphs: [
          "Zákazníkovi se uděluje nevýhradní, nepřenosné právo užívat Službu po dobu trvání smlouvy pro interní podnikatelské účely Organizace.",
          "Zpětná analýza, obcházení technických limitů, hromadné stahování mimo exportní funkce nebo zasahování do bezpečnosti Služby není dovoleno.",
        ],
      },
      {
        heading: "5. Ceny, fakturace a splatnost",
        paragraphs: [
          "Ceny modulů a licencí jsou uvedeny v ceníku na webu nebo v individuální nabídce; uvedeny obvykle bez DPH, pokud není uvedeno jinak.",
          "Provozovatel vystaví daňový doklad dle údajů Zákazníka; Zákazník odpovídá za správnost fakturačních údajů.",
          "Splatnost faktur je dle doby uvedené na dokladu, není-li sjednáno jinak. Při prodlení může Provozovatel účtovat zákonný úrok z prodlení a případně omezit Službu po předchozím upozornění.",
        ],
      },
      {
        heading: "6. Změny cen a plánů",
        paragraphs: [
          "Provozovatel může ceník upravit s přiměřenou výpovědní dobou; pro běžící fakturační období se změna obvykle projeví od následujícího období.",
        ],
      },
      {
        heading: "7. Dostupnost, údržba a aktualizace",
        paragraphs: [
          "Služba je poskytována s cílem vysoké dostupnosti; plánovaná údržba bude přiměřeně oznámena.",
          "Provozovatel může Službu aktualizovat; bezpečnostní aktualizace mohou proběhnout i bez předchozího upozornění.",
          "Výpadky způsobené třetími stranami (hosting, cloud, e-mail, AI poskytovatel) nejsou vždy v kontrole Provozovatele.",
        ],
      },
      {
        heading: "8. Data Zákazníka, zálohování a export",
        paragraphs: [
          "Obsah vložený Zákazníkem do Služby zůstává v dispozici Zákazníka; Provozovatel jej zpracovává dle smlouvy a zásad ochrany osobních údajů.",
          "Organizace může v rozsahu implementovaných funkcí vytvářet zálohy dat — dle nastavení modulu zálohování v portálu.",
          "Po ukončení smlouvy lze data exportovat v rozsahu dostupných exportních funkcí; po uplynutí lhůty mohou být smazána dle retenčních pravidel.",
        ],
      },
      {
        heading: "9. Ukončení služby",
        bullets: [
          "Smlouvu lze ukončit výpovědí dle sjednané doby nebo dohodou.",
          "Při podstatném porušení podmínek může Provozovatel přístup ukončit po předchozím vyzvání k nápravě, pokud to povaha porušení dovoluje.",
        ],
      },
      {
        heading: "10. AI funkce",
        paragraphs: [
          "AI funkce Služby jsou podpůrným nástrojem. Výstupy (nabídky, smlouvy, dodatky, kalkulace, shrnutí, odpovědi, doporučení) mohou obsahovat nepřesnosti nebo chyby.",
          "Zákazník a Uživatel musí výstupy před použitím, odesláním nebo podpisem přiměřeně zkontrolovat.",
          "AI výstup není právní, daňové, účetní ani jiné odborné poradenství. U dokumentů s právními nebo finančními důsledky doporučujeme odbornou kontrolu.",
        ],
      },
      {
        heading: "11. Fakturační a smluvní dokumenty vytvořené ve Službě",
        paragraphs: [
          "Služba poskytuje technické nástroje pro sestavení a evidenci dokladů a návrhů smluv na základě údajů vložených Zákazníkem a nastavení Organizace.",
          "Zákazník odpovídá za kontrolu údajů před vystavením nebo odesláním dokladu (odběratel, částky, DPH, data, splatnost, bankovní údaje, zálohy).",
          "Za rozhodnutí dokument použít a za jeho konečný obsah odpovídá Zákazník. Šablona nemusí odpovídat konkrétní situaci; právní předpisy se mohou měnit.",
        ],
      },
      {
        heading: "12. Omezení odpovědnosti",
        paragraphs: [
          liabilityNote,
          "Provozovatel neodpovídá v rozsahu dovoleném platnými právními předpisy za nepřímé škody, ušlý zisk, ztrátu dat způsobenou nesprávným zálohováním ze strany Zákazníka, škody z nesprávně zadaných údajů, chyby třetích stran nebo za škody vzniklé na základě nezkontrolovaných AI výstupů.",
          "Odpovědnost za vědomé porušení povinností nebo za škodu na zdraví a další případy, kde ji zákon vyloučit nedovolí, tím není dotčena.",
        ],
      },
      {
        heading: "13. Reklamace",
        paragraphs: [
          "Vady Služby uplatněte bez zbytečného odkladu na kontaktní e-mail Provozovatele. Společně určíme způsob odstranění vady nebo přiměřenou slevu.",
        ],
      },
      {
        heading: "14. Ochrana osobních údajů",
        paragraphs: [
          "Zpracování osobních údajů se řídí Zásadami ochrany osobních údajů a informacemi k GDPR zveřejněnými na webu.",
        ],
      },
      {
        heading: "15. Rozhodné právo a závěr",
        paragraphs: [
          "Vztahy se řídí právním řádem České republiky. Příslušnost soudů se řídí obecně závaznými pravidly.",
          `Účinnost těchto podmínek od ${LEGAL_TERMS.effectiveDate}, verze ${LEGAL_TERMS.version}, poslední aktualizace ${LEGAL_TERMS.lastUpdated}.`,
        ],
      },
    ],
  };
}
