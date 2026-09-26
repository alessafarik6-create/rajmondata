/** Doplňkové indexovatelné produktové landing pages (SEO). */
export const SEO_EXTRA_PRODUCT_PAGES = [
  {
    slug: "email-pro-firmy",
    title: "Firemní e-mail v portálu | RAJMONDATA",
    description:
      "Více firemních schránek, e-mail v RAJMONDATA, přiřazení ke zakázce, přílohy, stav čeká na odpověď, předání kolegovi a AI návrhy odpovědí.",
    h1: "E-mail pro firmy přímo v podnikovém portálu",
    kind: "feature",
    breadcrumbLabel: "E-mail",
    intro:
      "Obchodní komunikace nemusí běžet v soukromých schránkách. RAJMONDATA propojuje firemní e-mail se zakázkami, poptávkami a týmem — podle nastavení organizace a oprávnění uživatelů.",
    blocks: [
      { type: "h3", text: "Co umí e-mail v portálu" },
      {
        type: "ul",
        items: [
          "Více firemních schránek (IMAP/SMTP) v jednom rozhraní",
          "Příchozí a odchozí pošta včetně příloh",
          "Přiřazení e-mailu a příloh ke konkrétní zakázce",
          "Stav „čeká na odpověď“ a předání zprávy kolegovi",
          "AI návrhy odpovědí a třídění prioritní komunikace",
          "Oprávnění podle rolí — kdo vidí kterou schránku",
        ],
      },
      { type: "h3", text: "Praktické použití" },
      {
        type: "p",
        text: "Poptávka z webu dorazí do schránky, obchodník ji otevře v portálu, přiřadí k zakázce a pošle nabídku. Kolega vidí historii u stejného obchodního případu — bez přeposílání PDF e-mailem.",
      },
    ],
    relatedSlugs: ["poptavky-a-nabidky", "rizeni-zakazek", "ai-pro-firmy"],
  },
  {
    slug: "vozovy-park",
    title: "Vozový park a GPS monitoring | RAJMONDATA",
    description:
      "Evidence vozidel firmy, stav pohybu, propojení s Ecofleet GPS a přehled pro vedení — modul vozového parku v RAJMONDATA.",
    h1: "Vozový park a monitoring vozidel",
    kind: "feature",
    breadcrumbLabel: "Vozový park",
    intro:
      "Modul vozového parku slouží k evidenci vozidel, řidičů a stavu z GPS providera (např. Ecofleet). Bez připojené integrace zobrazíte evidenci vozidel; s integrací i pohyb, stání a offline stavy.",
    blocks: [
      {
        type: "ul",
        items: [
          "Evidence vozidel, SPZ a přiřazených řidičů",
          "Stav: v pohybu, stojí, offline (podle dat z providera)",
          "Odkaz z portálu na detail vozového parku",
          "Integrace Ecofleet — po nastavení superadminem / v modulu",
        ],
      },
    ],
    relatedSlugs: ["rizeni-zakazek", "dochazka-zamestnancu"],
  },
  {
    slug: "rizeni-vyroby",
    title: "Řízení výroby u zakázek | RAJMONDATA",
    description:
      "Výrobní kroky, stav ve dílně, materiál ze skladu a dokumentace propojená se zakázkou v modulu výroby RAJMONDATA.",
    h1: "Řízení výroby navázané na zakázku",
    kind: "feature",
    breadcrumbLabel: "Výroba",
    intro:
      "Výroba v RAJMONDATA není samostatný ostrov — stejná zakázka, kterou obchodník založil z poptávky, pokračuje ve výrobě a na montáži u zákazníka.",
    blocks: [
      {
        type: "ul",
        items: [
          "Výrobní záznamy a stav zakázky ve výrobě",
          "Materiál a spotřeba navázaná na sklad",
          "Přehled pro dílnu a vedení",
          "Dokumentace k výrobě u zakázky",
        ],
      },
    ],
    relatedSlugs: ["skladove-hospodarstvi", "rizeni-zakazek", "sklad-a-vyroba"],
  },
  {
    slug: "skladove-hospodarstvi",
    title: "Skladové hospodářství pro firmy | RAJMONDATA",
    description:
      "Skladové položky, naskladnění, vyskladnění k zakázce, historie pohybů a návaznost na výrobu v RAJMONDATA.",
    h1: "Skladové hospodářství a materiál u zakázek",
    kind: "feature",
    breadcrumbLabel: "Sklad",
    intro:
      "Sklad v RAJMONDATA eviduje položky a pohyby. Materiál lze vyskladnit ke konkrétní zakázce nebo výrobě — vedení vidí, co se spotřebovalo v rámci obchodního případu.",
    blocks: [
      {
        type: "ul",
        items: [
          "Skladové karty a jednotky",
          "Příjem a výdej materiálu",
          "Historie pohybů a audit",
          "Návaznost na výrobu a rozpočet zakázky",
        ],
      },
    ],
    relatedSlugs: ["rizeni-vyroby", "rizeni-zakazek"],
  },
  {
    slug: "firemni-portal",
    title: "Firemní portál pro řízení firmy | RAJMONDATA",
    description:
      "RAJMONDATA je podnikový portál — zakázky, lidé, dokumenty, finance, komunikace a AI v jednom přihlášení pro celou organizaci.",
    h1: "Firemní portál RAJMONDATA — jedno místo pro provoz firmy",
    kind: "feature",
    breadcrumbLabel: "Firemní portál",
    intro:
      "RAJMONDATA není jen CRM ani jen fakturační program. Jde o webový firemní portál, kde mají zaměstnanci role, oprávnění a moduly podle licence organizace — od poptávky po fakturu a docházku.",
    blocks: [
      { type: "h3", text: "Pro koho je portál" },
      {
        type: "ul",
        items: [
          "Vedení a administrativa — přehled, finance, licence",
          "Obchod — poptávky, nabídky, zákazníci",
          "Realizace — zakázky, úkoly, fotodokumentace",
          "Dílna a sklad — výroba a materiál",
          "Zaměstnanci — docházka, chat, výkazy",
          "Zákazníci — samostatný zákaznický portál (volitelně)",
        ],
      },
      {
        type: "p",
        text: "Portál běží v prohlížeči — není nutná instalace na každý počítač. Přístup z mobilu a tabletu pro práci v terénu.",
      },
    ],
    relatedSlugs: ["rizeni-zakazek", "ai-pro-firmy", "dochazka-zamestnancu"],
  },
  {
    slug: "kamerovy-system",
    title: "Kamerový systém a monitoring provozu | RAJMONDATA",
    description:
      "Propojení kamer (např. Hikvision) s firemním portálem — živý náhled, události a kontext zakázky podle nastavení organizace.",
    h1: "Kamerový systém v kontextu firmy",
    kind: "feature",
    breadcrumbLabel: "Kamerový systém",
    intro:
      "Modul kamer doplňuje řízení firmy o vizuální dohled nad provozem, skladem nebo montáží. Integrace závisí na aktivním modulu a konfiguraci — v portálu vidíte kamery a události, ke kterým máte oprávnění.",
    blocks: [
      {
        type: "ul",
        items: [
          "Evidence kamer a přístup podle rolí",
          "Živý náhled a historie událostí (podle integrace)",
          "Propojení s provozem firmy v jednom přihlášení",
          "Bezpečný přístup pouze pro oprávněné uživatele organizace",
        ],
      },
    ],
    relatedSlugs: ["rizeni-zakazek", "vozovy-park", "firemni-portal"],
  },
];
