import type { PublicOperatorInfo } from "@/lib/marketing/load-billing-provider-public";
import { LEGAL_COOKIES } from "@/lib/marketing/legal-versions";
import type { LegalDocumentRender } from "@/lib/marketing/legal/legal-section-types";

export function buildCookiesDocument(operator: PublicOperatorInfo): LegalDocumentRender {
  return {
    meta: LEGAL_COOKIES,
    disclaimer:
      "Audit cookies a local storage vychází z aktuální implementace aplikace. Po přidání analytických nebo marketingových nástrojů je nutné text a consent mechanismus aktualizovat.",
    operator,
    sections: [
      {
        heading: "Shrnutí",
        paragraphs: [
          "Veřejný marketingový web a aplikace RAJMONDATA primárně používají technicky nezbytné cookies a local storage pro fungování přihlášení, relace a uživatelského rozhraní.",
          "V době auditu nebyly identifikovány samostatné marketingové nebo analytické cookies třetích stran (např. Google Analytics) ve veřejné části — pokud je později nasadíte, vyžaduje to souhlas před načtením.",
        ],
      },
      {
        heading: "Nezbytné cookies",
        bullets: [
          "Firebase Authentication — session / token pro přihlášení do portálu.",
          "Superadmin session cookie — přístup do administrace platformy (pouze pro oprávněné uživatele).",
          "Sidebar stav (UI cookie) — zapamatování rozbalení postranního panelu v aplikaci.",
        ],
      },
      {
        heading: "Local storage (ne cookies, ale obdobný účel)",
        bullets: [
          "Nedávné vyhledávání v portálu.",
          "PWA — informace o instalaci aplikace do zařízení.",
          "Uložení rozložení panelů a preferencí UI (např. detail zakázky, výroba) — zlepšení použitelnosti.",
        ],
      },
      {
        heading: "Preferenční / analytické / marketingové",
        paragraphs: [
          "Aktuálně nejsou na veřejném webu povinně používány. Embedded promo video z administrace SEO může načítat obsah z YouTube (nocookie doména) — při přehrání platí zásady Google/YouTube.",
        ],
      },
      {
        heading: "Správa v prohlížeči",
        paragraphs: [
          "Cookies můžete smazat nebo blokovat v nastavení prohlížeče; některé funkce (přihlášení) pak nebudou dostupné.",
        ],
      },
      {
        heading: "Verze",
        paragraphs: [
          `Verze ${LEGAL_COOKIES.version}, účinnost ${LEGAL_COOKIES.effectiveDate}, aktualizace ${LEGAL_COOKIES.lastUpdated}.`,
        ],
      },
    ],
  };
}
