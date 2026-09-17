import {
  LEGAL_COOKIES,
  LEGAL_GDPR,
  LEGAL_PRIVACY,
  LEGAL_TERMS,
  LEGAL_DPA_SLUG,
} from "@/lib/marketing/legal-versions";

export type MarketingContentBlock =
  | { type: "p"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] };

export type MarketingPageKind = "feature" | "legal" | "solution";

export type MarketingPageDef = {
  slug: string;
  title: string;
  description: string;
  h1: string;
  kind: MarketingPageKind;
  legalKey?: "terms" | "privacy" | "gdpr" | "cookies" | "dpa";
  intro?: string;
  blocks?: MarketingContentBlock[];
  relatedSlugs?: string[];
  breadcrumbLabel?: string;
};

const pages: MarketingPageDef[] = [
  {
    slug: "funkce",
    title: "RAJMONDATA | Přehled funkcí firemního portálu a CRM",
    description:
      "Kompletní přehled modulů RAJMONDATA: poptávky, nabídky, zakázky, docházka, fakturace, výroba, sklad, dokumenty a AI asistent pro firmy.",
    h1: "Funkce firemního portálu RAJMONDATA",
    kind: "feature",
    intro:
      "RAJMONDATA je firemní informační systém pro firmy, které vedou zakázky na míru. Níže najdete hlavní oblasti — každou popisujeme podrobněji na samostatné stránce.",
    blocks: [
      {
        type: "ul",
        items: [
          "Poptávky a nabídky včetně AI návrhů",
          "Zakázky, zaměření, smlouvy a dokumentace",
          "Docházka, externí terminál, výkazy a mzdy",
          "Fakturace, rozpočty, vícepráce a zálohy",
          "Komunikace se zákazníky a uvnitř týmu",
          "Výroba, sklad, reporty a finance",
          "Role, oprávnění a zákaznický portál",
        ],
      },
    ],
    relatedSlugs: ["rizeni-zakazek", "poptavky-a-nabidky", "evidence-dochazky", "ai-pro-firmy"],
  },
  {
    slug: "rizeni-zakazek",
    title: "RAJMONDATA | Software pro řízení zakázek a CRM",
    description:
      "Evidence zakázek od poptávky po fakturu: termíny, úkoly, zaměření, rozpočet, vícepráce, dokumenty a komunikace v jednom systému.",
    h1: "Řízení zakázek a evidence obchodních případů",
    kind: "feature",
    intro:
      "Program pro zakázky v RAJMONDATA propojuje obchod, realizaci a administrativu. Každá zakázka je jeden ucelený záznam — bez přepisování mezi tabulkami.",
    blocks: [
      { type: "h3", text: "Co u zakázky řešíte" },
      {
        type: "ul",
        items: [
          "Stav, termíny a přiřazení pracovníků",
          "Úkoly a průběh realizace",
          "Zaměření, fotografie a složky dokumentů",
          "Položkový rozpočet, vícepráce a zálohy",
          "Smlouvy, dodatky a fakturace",
          "Výrobní kroky a skladové návaznosti",
          "Chat se zákazníkem a interní komunikace",
        ],
      },
      {
        type: "p",
        text: "CRM pro stavební firmy i montážní firmy v praxi znamená i rychlý přehled — kdo má zakázku na starosti, co zbývá dodat a jaká faktura navazuje na rozpočet.",
      },
    ],
    relatedSlugs: ["poptavky-a-nabidky", "fakturace", "komunikace-se-zakazniky"],
  },
  {
    slug: "evidence-dochazky",
    title: "RAJMONDATA | Docházkový systém a evidence pracovní doby",
    description:
      "Evidence docházky zaměstnanců, externí docházkový terminál na tabletu, příchody a odchody navázané na zakázky a výkazy práce.",
    h1: "Docházka zaměstnanců a externí terminál",
    kind: "feature",
    intro:
      "Docházkový systém v portálu eviduje příchod, odchod a odpracovanou dobu. Data lze propojit s výkazy práce a zakázkami.",
    blocks: [
      { type: "h3", text: "Externí docházkový terminál" },
      {
        type: "p",
        text: "Tablet u vstupu do firmy, dílny, skladu nebo provozovny může sloužit jako terminál — zaměstnanec se přihlásí PINem a zaznamená docházku bez plného administrativního přístupu do portálu.",
      },
      { type: "h3", text: "Evidence v portálu" },
      {
        type: "ul",
        items: [
          "Příchod a odchod podle období a zaměstnance",
          "Návaznost na výkazy práce a zakázky",
          "Přehled pro vedení a schvalování",
        ],
      },
    ],
    relatedSlugs: ["prace-a-mzdy", "rizeni-zakazek", "pro-remeslniky"],
  },
  {
    slug: "prace-a-mzdy",
    title: "RAJMONDATA | Výkazy práce, sazby a přehledy pro mzdy",
    description:
      "Výkazy práce na zakázkách, hodinové sazby, schvalování, zálohy a dluhy zaměstnanců — technická evidence pro vedení firmy.",
    h1: "Práce, výkazy a podklady pro mzdy",
    kind: "feature",
    intro:
      "Modul propojuje odpracované hodiny a popis práce se zakázkami. RAJMONDATA nenahrazuje kompletní mzdový ani účetní software — poskytuje přehledné podklady a PDF výstupy podle nastavení organizace.",
    blocks: [
      {
        type: "ul",
        items: [
          "Práce na zakázkách a odpracované hodiny",
          "Popis práce, kontrola a schválení",
          "Hodinové sazby, zálohy, dluhy a období",
          "Evidence vyplacení a tiskové přehledy",
        ],
      },
    ],
    relatedSlugs: ["evidence-dochazky", "rizeni-zakazek"],
  },
  {
    slug: "poptavky-a-nabidky",
    title: "RAJMONDATA | Správa poptávek a tvorba nabídek",
    description:
      "Poptávky z webu firmy do portálu, evidence stavu a komunikace, tvorba nabídek s položkami, PDF a odesláním e-mailem.",
    h1: "Poptávky a nabídky na jednom místě",
    kind: "feature",
    intro:
      "Správa poptávek začíná u kontaktu a požadavku zákazníka. Formulář z vašeho webu může lead doručit přímo do RAJMONDATA.",
    blocks: [
      {
        type: "ul",
        items: [
          "Kontakt, požadavek, stav a přílohy",
          "Historie komunikace a další kroky",
          "Nabídka s položkami, cenami a PDF",
          "Odeslání e-mailem z portálu",
          "Návaznost na zákazníka, poptávku a zakázku",
        ],
      },
      {
        type: "p",
        text: "AI může pomoci připravit návrh nabídky podle pravidel organizace — výsledek vždy kontrolujete před odesláním zákazníkovi.",
      },
    ],
    relatedSlugs: ["ai-pro-firmy", "rizeni-zakazek", "fakturace"],
  },
  {
    slug: "ai-pro-firmy",
    title: "RAJMONDATA | AI pro firmy — nabídky, dokumenty a asistent",
    description:
      "AI asistent v portálu, návrhy nabídek, kontrola dokumentů a orientace v systému. Výstupy jsou podpůrné — finální rozhodnutí má uživatel.",
    h1: "Umělá inteligence jako podpora práce ve firmě",
    kind: "feature",
    intro:
      "AI funkce RAJMONDATA urychlují rutinní práci s texty a dokumenty. Nepředstavují právní, daňové ani účetní poradenství.",
    blocks: [
      { type: "h3", text: "Firemní AI asistent" },
      {
        type: "p",
        text: "Nápověda uvnitř portálu — hledání funkcí, orientace v menu a odpovědi nad firemními podklady, pokud je AI centrum nastaveno.",
      },
      { type: "h3", text: "AI nabídky a dokumenty" },
      {
        type: "ul",
        items: [
          "Návrh nabídky z poptávky a ceníků",
          "Sumarizace a vyhledávání v nahrané dokumentaci",
          "Kontrola podkladů před rozhodnutím",
        ],
      },
      {
        type: "p",
        text: "Výstupy mohou obsahovat nepřesnosti. Před použitím je vždy zkontrolujte — zejména u finančních a smluvních dokumentů.",
      },
    ],
    relatedSlugs: ["ai-smlouvy-a-dodatky", "poptavky-a-nabidky"],
  },
  {
    slug: "ai-smlouvy-a-dodatky",
    title: "RAJMONDATA | AI návrhy smluv a dodatků ke smlouvám",
    description:
      "AI asistent pro přípravu návrhu smlouvy nebo dodatku navázaného na zakázku. Uživatel text upraví a schválí — nenahrazuje to advokáta.",
    h1: "AI pomoc se smlouvami a dodatky",
    kind: "feature",
    intro:
      "RAJMONDATA poskytuje nástroj k vytvoření návrhu smlouvy nebo dodatku podle podkladů zakázky. Marketingově nejde o „AI právníka“ — jde o asistenta pro přípravu textu.",
    blocks: [
      {
        type: "ul",
        items: [
          "Návrh smlouvy u zakázky podle šablon a dat",
          "Dodatek z popisu změny (termín, vícepráce, cena)",
          "Editace, export do PDF a evidence ve složce zakázky",
        ],
      },
      {
        type: "p",
        text: "Dokumenty s významnými právními důsledky doporučujeme nechat zkontrolovat odborníkem. AI může vytvořit chybnou formulaci nebo neodpovídat konkrétní situaci.",
      },
    ],
    relatedSlugs: ["ai-pro-firmy", "rizeni-zakazek", "obchodni-podminky"],
  },
  {
    slug: "fakturace",
    title: "RAJMONDATA | Fakturace, zálohové faktury a doklady",
    description:
      "Faktury a zálohové faktury navázané na zakázku, položky, DPH, PDF a odesílání z portálu. Uživatel kontroluje údaje před vystavením.",
    h1: "Fakturace a doklady u zakázek",
    kind: "feature",
    intro:
      "Technické nástroje pro sestavení a evidenci faktur na základě údajů, které do systému vložíte, a nastavení organizace.",
    blocks: [
      {
        type: "ul",
        items: [
          "Faktury a zálohové faktury s položkami a DPH",
          "Návaznost na položkový rozpočet a vícepráce",
          "PDF, splatnost a historie u zakázky",
          "Odeslání e-mailem z portálu",
        ],
      },
      {
        type: "p",
        text: "Před odesláním nebo vystavením dokladu zkontrolujte odběratele, částky, sazby DPH, data a bankovní údaje. RAJMONDATA nenahrazuje účetní software vaší firmy.",
      },
    ],
    relatedSlugs: ["rizeni-zakazek", "poptavky-a-nabidky"],
  },
  {
    slug: "komunikace-se-zakazniky",
    title: "RAJMONDATA | Komunikace se zákazníky a interní chat",
    description:
      "Chat se zákazníkem u zakázky, zákaznický portál, interní zprávy a schůzky — historie u obchodního případu.",
    h1: "Komunikace se zákazníky i v týmu",
    kind: "feature",
    intro:
      "Firemní komunikace patří k zakázce, ne do roztříštěných kanálů. RAJMONDATA ukládá konverzace a zprávy v kontextu obchodního případu.",
    blocks: [
      {
        type: "ul",
        items: [
          "Chat se zákazníkem navázaný na zakázku",
          "Zákaznický portál s průběhem a dokumenty",
          "Interní chat a zprávy zaměstnanců",
          "Evidence schůzek a kontaktů u zákazníka",
        ],
      },
    ],
    relatedSlugs: ["rizeni-zakazek", "poptavky-a-nabidky"],
  },
  {
    slug: "sklad-a-vyroba",
    title: "RAJMONDATA | Výroba, sklad a materiál u zakázky",
    description:
      "Řízení výrobních kroků, evidence skladu a skladových pohybů propojené s konkrétní zakázkou — dle aktivních modulů licence.",
    h1: "Výroba a sklad v návaznosti na zakázky",
    kind: "feature",
    intro:
      "Pro firmy s dílnou nebo skladem lze sledovat materiál, výrobní postupy a spotřebu v kontextu realizace.",
    blocks: [
      {
        type: "ul",
        items: [
          "Výrobní kroky a stav zakázky ve výrobě",
          "Skladové položky a pohyby podle implementace modulu",
          "Materiál a dokumentace u zakázky",
        ],
      },
    ],
    relatedSlugs: ["rizeni-zakazek", "pro-montazni-firmy"],
  },
  {
    slug: "pro-remeslniky",
    title: "RAJMONDATA | CRM a software pro řemeslníky",
    description:
      "Program pro řemeslnické firmy: poptávky, nabídky, zakázky v terénu, zaměření, fotodokumentace a fakturace.",
    h1: "RAJMONDATA pro řemeslnické firmy",
    kind: "solution",
    intro:
      "Řemeslníci potřebují rychlou reakci na poptávku a přehled o tom, kdo kde pracuje. Portál funguje v prohlížeči na telefonu i tabletu.",
    blocks: [
      {
        type: "ul",
        items: [
          "Poptávky a nabídky bez zbytečné administrativy",
          "Zaměření s fotografiemi z místa realizace",
          "Docházkový terminál v dílně",
          "Fakturace a komunikace se zákazníkem",
        ],
      },
    ],
    relatedSlugs: ["poptavky-a-nabidky", "evidence-dochazky", "rizeni-zakazek"],
  },
  {
    slug: "pro-montazni-firmy",
    title: "RAJMONDATA | Řízení montážní firmy a zakázek",
    description:
      "Software pro montážní firmy — pergoly, zimní zahrady, zasklení: zakázky, montážníci, zaměření, výroba a fakturace.",
    h1: "Pro montážní a realizační firmy",
    kind: "solution",
    intro:
      "Řízení montážní firmy znamená sladit obchod, výrobu, montáže na stavbách a fakturaci. RAJMONDATA to spojuje v jednom tenantovi pro vaši organizaci.",
    blocks: [
      {
        type: "p",
        text: "Typické scénáře: poptávka z webu, zaměření u zákazníka, zakázka s úkoly pro montéry, fotodokumentace, vícepráce a zálohová i konečná faktura.",
      },
    ],
    relatedSlugs: ["sklad-a-vyroba", "komunikace-se-zakazniky"],
  },
  {
    slug: "pro-stavebni-firmy",
    title: "RAJMONDATA | CRM pro stavební firmy a zakázky",
    description:
      "Evidence zakázek, rozpočty, vícepráce, dokumentace staveb a komunikace s investorem — firemní portál pro stavební práce.",
    h1: "Pro stavební a realizační firmy",
    kind: "solution",
    intro:
      "Stavební firmy pracují s položkovými rozpočty, změnami na stavbě a sérií dokladů. Systém drží historii u zakázky a zákazníka.",
    blocks: [
      {
        type: "ul",
        items: [
          "Položkový rozpočet a vícepráce",
          "Smlouvy, dodatky a složky dokumentů",
          "Reporty a finanční přehledy v portálu",
          "Role pro účetní read-only přístup",
        ],
      },
    ],
    relatedSlugs: ["fakturace", "rizeni-zakazek"],
  },
  {
    slug: LEGAL_TERMS.slug,
    title: "RAJMONDATA | Obchodní podmínky služby",
    description: "Všeobecné obchodní podmínky používání platformy RAJMONDATA (B2B SaaS). Návrh k právní revizi.",
    h1: LEGAL_TERMS.title,
    kind: "legal",
    legalKey: "terms",
    breadcrumbLabel: "Obchodní podmínky",
  },
  {
    slug: LEGAL_PRIVACY.slug,
    title: "RAJMONDATA | Zásady ochrany osobních údajů",
    description: "Informace o zpracování osobních údajů provozovatele platformy RAJMONDATA. Návrh k právní revizi.",
    h1: LEGAL_PRIVACY.title,
    kind: "legal",
    legalKey: "privacy",
    breadcrumbLabel: "Ochrana osobních údajů",
  },
  {
    slug: LEGAL_GDPR.slug,
    title: "RAJMONDATA | GDPR — správce a zpracovatel",
    description:
      "Role RAJMONDATA při zpracování údajů, informace pro zákaznické organizace a návrh zpracovatelské smlouvy.",
    h1: "GDPR a zpracování osobních údajů",
    kind: "legal",
    legalKey: "gdpr",
    breadcrumbLabel: "GDPR",
  },
  {
    slug: LEGAL_COOKIES.slug,
    title: "RAJMONDATA | Cookies a lokální úložiště",
    description: "Přehled cookies a local storage na veřejném webu a v aplikaci RAJMONDATA.",
    h1: LEGAL_COOKIES.title,
    kind: "legal",
    legalKey: "cookies",
    breadcrumbLabel: "Cookies",
  },
  {
    slug: LEGAL_DPA_SLUG,
    title: "RAJMONDATA | Návrh zpracovatelské smlouvy (DPA)",
    description: "Návrh smlouvy o zpracování osobních údajů podle čl. 28 GDPR pro zákaznické organizace.",
    h1: "Návrh smlouvy o zpracování osobních údajů",
    kind: "legal",
    legalKey: "dpa",
    breadcrumbLabel: "Zpracovatelská smlouva",
  },
];

export const MARKETING_PAGES: MarketingPageDef[] = pages;

export function getMarketingPageBySlug(slug: string): MarketingPageDef | undefined {
  return MARKETING_PAGES.find((p) => p.slug === slug);
}

export function getAllMarketingSlugs(): string[] {
  return MARKETING_PAGES.map((p) => p.slug);
}

export function getIndexableMarketingPages(): MarketingPageDef[] {
  return MARKETING_PAGES.filter((p) => p.kind !== "legal" || p.legalKey !== "dpa");
}

/** DPA stránka je právní příloha — indexovat lze, ale není v hlavním menu. */
export const PUBLIC_SITEMAP_SLUGS = MARKETING_PAGES.map((p) => p.slug);
