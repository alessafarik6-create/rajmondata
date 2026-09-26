/** Doplňkové indexovatelné produktové landing pages (SEO). */
export const SEO_EXTRA_PRODUCT_PAGES = [
  {
    slug: "crm",
    title: "CRM systém pro firmy s AI | RAJMONDATA",
    description:
      "Online CRM pro firmy: evidence zákazníků, poptávky, obchodní případy, nabídky, zakázky, e-mail a kalendář propojené s řízením firmy v českém systému RAJMONDATA.",
    h1: "CRM systém pro zákazníky, obchod a zakázky",
    kind: "feature",
    breadcrumbLabel: "CRM",
    intro:
      "CRM v RAJMONDATA není samostatná tabulka kontaktů. Zákazník, poptávka, nabídka a zakázka sdílejí stejnou historii — obchodník i realizace vidí, co bylo domluveno, co zbývá dodat a jaká faktura navazuje na rozpočet.",
    blocks: [
      { type: "h3", text: "Co je CRM systém" },
      {
        type: "p",
        text: "CRM (Customer Relationship Management) je software pro správu vztahů se zákazníky — kontakty, obchodní příležitosti, komunikaci a navazující zakázky. Pro montážní a zakázkové firmy znamená CRM především přehled: kdo poptával, jaká nabídka šla ven, kdo zakázku realizuje a jak dopadla marže.",
      },
      { type: "h3", text: "CRM v RAJMONDATA" },
      {
        type: "p",
        text: "RAJMONDATA je český online CRM software integrovaný s ERP oblastmi portálu. Obchod nekončí u karty zákazníka — pokračuje v řízení zakázek, docházce, výrobě, skladu a fakturaci. CRM pro firmy s vlastní výrobou tak nemusí synchronizovat data mezi několika aplikacemi.",
      },
      { type: "h3", text: "Evidence zákazníků a správa zákazníků" },
      {
        type: "ul",
        items: [
          "Karty zákazníků s adresami, kontakty a poznámkami",
          "Historie poptávek, nabídek a zakázek u jednoho subjektu",
          "Dokumenty a komunikace navázané na zákazníka nebo obchodní případ",
          "Globální vyhledávání zákazníka, zakázky nebo faktury v portálu",
        ],
      },
      { type: "h3", text: "Poptávky a obchodní případy" },
      {
        type: "p",
        text: "Poptávka z webu nebo ruční záznam má stav, přiřazeného obchodníka a přílohy. Obchodní případ můžete vést od první reakce až po převod na zakázku — bez přepisování do jiného systému.",
      },
      { type: "h3", text: "Nabídky a zakázky" },
      {
        type: "p",
        text: "Cenová nabídka vychází z poptávky nebo obchodního případu. Po schválení zákazníkem vznikne zakázka se stejným kontextem: rozpočet, termíny, pracovníci a fakturace. CRM s AI umí připravit návrh nabídky z údajů poptávky a firemních ceníků — výsledek vždy kontrolujete.",
      },
      { type: "h3", text: "E-mailová komunikace a kalendář" },
      {
        type: "ul",
        items: [
          "Firemní e-mail v portálu s vazbou na zakázku nebo poptávku",
          "Historie odeslaných nabídek a příloh",
          "Schůzky a plánování v kontextu zákazníka (podle aktivních modulů)",
        ],
      },
      { type: "h3", text: "Dokumenty, AI a reporting" },
      {
        type: "p",
        text: "Smlouvy, dodatky a složky u zakázky doplňují CRM vrstvu. AI asistent pomáhá s odpověďmi na e-maily, tvorbou nabídek a orientací v portálu. Reporting nad obchodem a zakázkami poskytuje vedení přehled o stavu pipeline — v rozsahu modulů vaší licence.",
      },
    ],
    relatedSlugs: ["rizeni-zakazek", "poptavky-a-nabidky", "erp-system", "ai-pro-firmy"],
  },
  {
    slug: "erp-system",
    title: "ERP systém pro firmy | RAJMONDATA",
    description:
      "ERP a firemní informační systém v jednom webovém portálu: zakázky, zaměstnanci, docházka, výroba, sklad, fakturace, vozový park a AI — bez náhrady plného účetnictví.",
    h1: "ERP systém pro řízení firmy v jednom prostředí",
    kind: "feature",
    breadcrumbLabel: "ERP",
    intro:
      "RAJMONDATA spojuje CRM oblast s provozními procesy firmy. Jde o podnikový informační systém pro řízení firmy — zakázky, lidi, materiál a doklady — v jednom přihlášení. Nenahrazuje kompletní účetní agendu; fakturaci a podklady exportujete dál podle vašeho účetního software.",
    blocks: [
      { type: "h3", text: "CRM vs ERP — jak to v RAJMONDATA funguje" },
      {
        type: "p",
        text: "CRM se soustředí na zákazníka a obchod: poptávky, nabídky, komunikaci a převod do zakázky. ERP v širším smyslu pokrývá řízení procesů ve firmě — realizaci zakázek, zaměstnance, docházku, výrobu, sklad, fakturaci a reporting. RAJMONDATA obě oblasti propojuje: stejná zakázka prochází obchodem i dílnou.",
      },
      { type: "h3", text: "Zakázky a řízení procesů" },
      {
        type: "p",
        text: "Zakázkový systém je jádro ERP vrstvy — termíny, úkoly, rozpočty, vícepráce, dokumenty a fakturace u jednoho obchodního případu.",
      },
      { type: "h3", text: "Zaměstnanci a docházka" },
      {
        type: "ul",
        items: [
          "Evidence zaměstnanců, rolí a oprávnění",
          "Docházkový terminál na tabletu, výkazy práce na zakázkách",
          "Podklady pro mzdy — bez náhrady mzdového účetnictví",
        ],
      },
      { type: "h3", text: "Výroba a sklad" },
      {
        type: "p",
        text: "Řízení výroby a skladová evidence materiálu navazují na konkrétní zakázku. Vedení vidí spotřebu a stav ve výrobě v kontextu zakázky, ne v oddělené tabulce.",
      },
      { type: "h3", text: "Dokumenty, fakturace a vozový park" },
      {
        type: "ul",
        items: [
          "Přijaté a vydané doklady, PDF a fotografie u zakázky",
          "Fakturace, zálohy a položkové rozpočty",
          "Evidence vozidel a GPS monitoring (podle integrace)",
        ],
      },
      { type: "h3", text: "Reporting a AI" },
      {
        type: "p",
        text: "Manažerské reporty a finanční přehledy v portálu doplňují každodenní řízení firem. AI automatizuje část administrativy — e-maily, nabídky a dokumenty — v rámci pravidel vaší organizace.",
      },
    ],
    relatedSlugs: ["crm", "rizeni-zakazek", "firemni-portal", "dochazka-zamestnancu"],
  },
  {
    slug: "crm-zdarma",
    title: "CRM zdarma vs. placený CRM | RAJMONDATA",
    description:
      "Co znamená CRM zdarma, co je zkušební verze a proč zakázková firma potřebuje CRM propojené se zakázkami a fakturací — bez falešných slibů.",
    h1: "CRM zdarma vs. placený CRM systém — co firma skutečně potřebuje?",
    kind: "feature",
    breadcrumbLabel: "CRM zdarma",
    intro:
      "Vyhledávání „CRM zdarma“ často vede k jednoduchým seznamům kontaktů. Pro firmu, která vede zakázky na míru, rozhoduje propojení s nabídkami, realizací a fakturací. RAJMONDATA není bezplatný CRM navždy — nabízí registraci firmy a zkušební období podle aktuálních podmínek platformy (délku a rozsah modulů určuje provozovatel po schválení registrace).",
    blocks: [
      { type: "h3", text: "Co bývá „CRM zdarma“" },
      {
        type: "ul",
        items: [
          "Omezený počet kontaktů nebo uživatelů",
          "Chybějící vazba na zakázky, sklad nebo fakturaci",
          "Export dat až v placeném tarifu",
          "Reklama nebo sdílení dat s třetími stranami",
        ],
      },
      { type: "h3", text: "Zkušební verze vs. trvalě zdarma" },
      {
        type: "p",
        text: "Zkušební období umožní ověřit workflow — poptávka, nabídka, zakázka — v reálném portálu. To není totéž jako neomezený free tarif. Před registrací si ověřte aktuální délku trialu a ceník na stránce funkcí; podmínky se mohou lišit podle licence organizace.",
      },
      { type: "h3", text: "Proč placený CRM systém dává smysl" },
      {
        type: "p",
        text: "Malá firma potřebuje CRM software, který šetří čas: méně přepisování mezi e-mailem a tabulkami, jasná historie u zákazníka a návaznost na docházku montérů i fakturu. Investice do jednoho českého online systému se vrací v rychlejší reakci na poptávky a menší chybovosti v dokumentech.",
      },
      { type: "h3", text: "Jak vyzkoušet RAJMONDATA" },
      {
        type: "p",
        text: "Registrace probíhá online. Po schválení firmy aktivuje provozovatel moduly podle licence — včetně CRM, řízení zakázek a dalších oblastí. Pro detail CRM funkcí navštivte stránku CRM systému; pro celkový přehled modulů stránku funkcí.",
      },
    ],
    relatedSlugs: ["crm", "funkce", "rizeni-zakazek"],
  },
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
