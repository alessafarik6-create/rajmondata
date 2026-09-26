import {
  LEGAL_COOKIES,
  LEGAL_PRIVACY,
  LEGAL_TERMS,
  LEGAL_DPA_SLUG,
  LEGACY_GDPR_SLUG,
} from "@/lib/marketing/legal-versions";
import { SEO_EXTRA_PRODUCT_PAGES } from "@/lib/marketing/seo-extra-product-pages";

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
  legalKey?: "terms" | "privacy" | "cookies" | "dpa";
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
    relatedSlugs: ["rizeni-zakazek", "poptavky-a-nabidky", "dochazka-zamestnancu", "ai-pro-firmy"],
  },
  {
    slug: "rizeni-zakazek",
    title: "Řízení zakázek pro firmy | RAJMONDATA",
    description:
      "Software na řízení zakázek: zákazník, termíny, úkoly, zaměření, fotodokumentace, rozpočty, vícepráce, zálohy, fakturace a zákaznický portál v jednom systému.",
    h1: "Řízení zakázek od poptávky až po fakturaci",
    kind: "feature",
    breadcrumbLabel: "Řízení zakázek",
    intro:
      "Program pro zakázky v RAJMONDATA propojuje obchod, realizaci a administrativu. Každá zakázka je jeden ucelený záznam — od první poptávky po konečnou fakturu, bez přepisování mezi tabulkami a chaty.",
    blocks: [
      { type: "h3", text: "Co u zakázky evidujete" },
      {
        type: "ul",
        items: [
          "Zákazníka, adresu realizace a kontakty",
          "Termíny, stav a přiřazené pracovníky",
          "Úkoly a průběh realizace",
          "Zaměření v terénu a fotodokumentaci",
          "Položkový rozpočet, vícepráce a zálohy",
          "Smlouvy, dodatky a složky dokumentů",
          "Fakturaci a historii komunikace",
          "Výrobní kroky, materiál a skladové návaznosti",
          "Zákaznický portál s průběhem pro investora",
        ],
      },
      { type: "h3", text: "Typický workflow ve firmě" },
      {
        type: "p",
        text: "Poptávka nebo nabídka se převede na zakázku. Obchodník přiřadí montéry, v terénu proběhne zaměření s fotografiemi. Rozpočet se upravuje o vícepráce, vystaví se záloha a po dokončení konečná faktura. Zákazník vidí vybrané informace v portálu.",
      },
      {
        type: "p",
        text: "CRM pro stavební i montážní firmy v praxi znamená rychlý přehled — kdo má zakázku na starosti, co zbývá dodat a jaká faktura navazuje na rozpočet.",
      },
    ],
    relatedSlugs: ["crm", "poptavky-a-nabidky", "fakturace-a-doklady", "komunikace-se-zakazniky"],
  },
  {
    slug: "dochazka-zamestnancu",
    title: "Docházkový systém pro zaměstnance a tablet | RAJMONDATA",
    description:
      "Docházkový systém pro firmy: zaměstnanci, terminál na tabletu, PIN, příchod/odchod, přestávky, výkazy, ruční korekce, mzdy a oprávnění.",
    h1: "Docházka zaměstnanců a terminál na tabletu",
    kind: "feature",
    breadcrumbLabel: "Docházka",
    intro:
      "Evidence pracovní doby v portálu propojuje příchody a odchody s výkazy práce, zakázkami a podklady pro mzdy. Vhodné pro dílny, montážní firmy i provozy s více zaměstnanci.",
    blocks: [
      { type: "h3", text: "Terminál na externím tabletu" },
      {
        type: "p",
        text: "Tablet u vstupu do firmy, dílny nebo skladu slouží jako docházkový terminál. Zaměstnanec zadá PIN, zaznamená příchod, odchod nebo přestávku — bez plného administrativního přístupu do portálu.",
      },
      { type: "h3", text: "Evidence v portálu" },
      {
        type: "ul",
        items: [
          "Přehled zaměstnanců a docházky podle období",
          "Příchod, odchod a přestávky z terminálu",
          "Výkazy práce navázané na zakázky",
          "Ruční korekce pro výplatu (audit zůstává u terminálu)",
          "Hodinové sazby, tarify a podklady pro mzdy",
          "Oprávnění — kdo vidí celou firmu a kdo jen sebe",
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
    relatedSlugs: ["dochazka-zamestnancu", "rizeni-zakazek"],
  },
  {
    slug: "poptavky-a-nabidky",
    title: "Správa poptávek a AI nabídky | RAJMONDATA",
    description:
      "Software na poptávky: přijetí z webu, odpověď z portálu, převod na nabídku, AI návrh, PDF, e-mail a převod do zakázky.",
    h1: "Poptávky a nabídky od prvního kontaktu po zakázku",
    kind: "feature",
    breadcrumbLabel: "Poptávky a nabídky",
    intro:
      "Správa poptávek spojuje marketing, obchod a realizaci. Lead z webu nebo telefonát se eviduje v portálu — obchodník odpoví, připraví nabídku a po schválení převede obchodní případ na zakázku.",
    blocks: [
      { type: "h3", text: "Od poptávky k nabídce" },
      {
        type: "ul",
        items: [
          "Přijetí poptávky z webového formuláře nebo ručně",
          "Kontakt, požadavek, stav, přílohy a historie",
          "Odpověď zákazníkovi přímo z portálu",
          "Převod poptávky na nabídku s položkami a cenami",
          "AI příprava návrhu nabídky z ceníků a pravidel firmy",
          "Export PDF a odeslání e-mailem",
          "Po akceptaci převod do zakázky se zákazníkem",
        ],
      },
      {
        type: "p",
        text: "Hledáte software na poptávky a tvorbu nabídek bez přepisování do tabulek? RAJMONDATA drží celou historii u jednoho obchodního případu — AI urychlí návrh textu, finální nabídku vždy schvaluje uživatel.",
      },
    ],
    relatedSlugs: ["ai-pro-firmy", "rizeni-zakazek", "fakturace-a-doklady"],
  },
  {
    slug: "ai-pro-firmy",
    title: "AI pro firemní zakázky, smlouvy a nabídky | RAJMONDATA",
    description:
      "AI tvorba nabídek, návrhy smluv a dodatků, nápověda v portálu, vyhledávání v návodech a firemní znalostní báze — vždy s kontrolou uživatele.",
    h1: "AI pro firmy — nabídky, smlouvy a firemní znalosti",
    kind: "feature",
    breadcrumbLabel: "AI pro firmy",
    intro:
      "AI v RAJMONDATA urychluje rutinní práci s texty a dokumenty. Nepředstavuje právní, daňové ani účetní poradenství — jde o asistenci a návrhy, které schvaluje váš tým.",
    blocks: [
      { type: "h3", text: "AI nabídky a obchod" },
      {
        type: "ul",
        items: [
          "Návrh nabídky z poptávky, rozměrů a firemních ceníků",
          "Práce s pravidly a šablonami organizace",
        ],
      },
      { type: "h3", text: "Smlouvy a dodatky" },
      {
        type: "ul",
        items: [
          "Návrh smlouvy nebo dodatku navázaného na zakázku",
          "Asistence při změně termínu, víceprací nebo ceny",
          "Editace textu a export do PDF — finální kontrola uživatelem",
        ],
      },
      { type: "h3", text: "Asistent, e-mail a znalostní báze" },
      {
        type: "ul",
        items: [
          "AI nápověda v portálu — kde najdu funkci, jak postupovat",
          "AI návrhy odpovědí na firemní e-mail (podle modulu e-mail)",
          "Vyhledávání v nahraných manuálech a interní dokumentaci",
          "Firemní znalostní báze v AI centru (podle aktivní licence)",
          "AI asistence u zakázek — shrnutí a práce s podklady",
        ],
      },
      {
        type: "p",
        text: "Výstupy AI mohou obsahovat nepřesnosti. Před odesláním zákazníkovi nebo podpisem dokumentu je vždy zkontrolujte — zejména u smluv a finančních údajů.",
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
    slug: "fakturace-a-doklady",
    title: "Fakturace, doklady a rozpočty zakázek | RAJMONDATA",
    description:
      "Položkový rozpočet, vícepráce, zálohové a konečné faktury, přijaté a vydané doklady, PDF a propojení se zakázkou v jednom portálu.",
    h1: "Fakturace a doklady navázané na zakázku",
    kind: "feature",
    breadcrumbLabel: "Fakturace",
    intro:
      "Fakturace v RAJMONDATA vychází z rozpočtu zakázky a provedených prací. Uživatel kontroluje odběratele, částky a DPH před vystavením — systém nenahrazuje účetní software firmy.",
    blocks: [
      {
        type: "ul",
        items: [
          "Položkový rozpočet a evidované vícepráce",
          "Zálohové faktury a konečná faktura po dokončení",
          "Přijaté a vydané doklady u zakázky",
          "PDF, splatnost a historie odeslání",
          "Odeslání e-mailem z portálu",
          "Přehled zbývající částky a DPH",
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
    title: "Zákaznický portál a komunikace u zakázky | RAJMONDATA",
    description:
      "Zákaznický portál: průběh zakázky, fotografie, dokumenty, chat a procento dokončení. Interní komunikace týmu u stejného obchodního případu.",
    h1: "Zákaznický portál a komunikace se zákazníkem",
    kind: "feature",
    breadcrumbLabel: "Zákaznický portál",
    intro:
      "Zákazník nemusí volat kvůli každému detailu. Ve zákaznickém portálu vidí průběh zakázky, vybrané fotografie a dokumenty — firma určí, co sdílí. Chat a interní zprávy zůstávají u zakázky, ne v soukromých aplikacích.",
    blocks: [
      {
        type: "ul",
        items: [
          "Průběh zakázky a procento dokončení pro zákazníka",
          "Fotografie a dokumenty ve sdílené složce",
          "Chat se zákazníkem navázaný na zakázku",
          "Informace pro investora bez opakovaného e-mailování",
          "Interní chat a zprávy zaměstnanců u zakázky",
          "Schůzky a kontakty u zákazníka",
        ],
      },
    ],
    relatedSlugs: ["rizeni-zakazek", "poptavky-a-nabidky"],
  },
  {
    slug: "sklad-a-vyroba",
    title: "Výroba, sklad a materiál u zakázky | RAJMONDATA",
    description:
      "Výrobní dílna, stav výroby, materiál, výdej ze skladu a dokumentace propojené s konkrétní zakázkou — podle aktivních modulů.",
    h1: "Výroba a sklad v návaznosti na zakázky",
    kind: "feature",
    breadcrumbLabel: "Výroba a sklad",
    intro:
      "Firmy s vlastní dílnou nebo skladem potřebují vědět, co se vyrábí, jaký materiál se spotřebuje a jak to souvisí s montáží u zákazníka. Moduly výroby a skladu v RAJMONDATA navazují na stejnou zakázku jako obchod a fakturace.",
    blocks: [
      { type: "h3", text: "Výrobní dílna a stav" },
      {
        type: "ul",
        items: [
          "Výrobní kroky a stav zakázky ve výrobě",
          "Přehled pro dílnu a vedení",
          "Dokumentace k výrobě u zakázky",
        ],
      },
      { type: "h3", text: "Sklad a materiál" },
      {
        type: "ul",
        items: [
          "Skladové položky a pohyby",
          "Výdej materiálu k zakázce",
          "Spotřeba a návaznost na rozpočet",
        ],
      },
    ],
    relatedSlugs: ["rizeni-zakazek", "pro-montazni-firmy", "rizeni-vyroby", "skladove-hospodarstvi"],
  },
  ...(SEO_EXTRA_PRODUCT_PAGES as MarketingPageDef[]),
  {
    slug: "pro-remeslniky",
    title: "Software pro řemeslníky a zakázky v terénu | RAJMONDATA",
    description:
      "Software pro řemeslníky: poptávky, AI nabídky, zaměření, fotografie, pracovníci, fakturace, docházka na tabletu a komunikace se zákazníkem.",
    h1: "Software pro řemeslnické firmy",
    kind: "solution",
    breadcrumbLabel: "Pro řemeslníky",
    intro:
      "Malá řemeslnická firma potřebuje rychlou reakci na poptávku, přehled zakázek v terénu a fakturaci bez zbytečné administrativy. RAJMONDATA běží v prohlížeči na telefonu, tabletu i počítači.",
    blocks: [
      {
        type: "ul",
        items: [
          "Poptávky z webu a tvorba nabídek včetně AI návrhu",
          "Zaměření s fotografiemi z místa realizace",
          "Přiřazení pracovníků a termíny montáže",
          "Fotodokumentace a zákaznický portál",
          "Docházkový terminál v dílně (PIN na tabletu)",
          "Fakturace, vícepráce a chat se zákazníkem",
        ],
      },
    ],
    relatedSlugs: ["poptavky-a-nabidky", "dochazka-zamestnancu", "rizeni-zakazek"],
  },
  {
    slug: "pro-montazni-firmy",
    title: "Software pro montážní firmy | RAJMONDATA",
    description:
      "Software pro montážní firmy: obchod, zaměření, montáže, výroba, docházka montérů, AI nabídky, termíny a fakturace v jednom systému.",
    h1: "Software pro montážní a realizační firmy",
    kind: "solution",
    breadcrumbLabel: "Pro montážní firmy",
    intro:
      "Montážní firma sladí obchod, výrobu v dílně, montáže u zákazníků a fakturaci. RAJMONDATA drží celý proces u jedné zakázky — od poptávky po konečnou fakturu.",
    blocks: [
      {
        type: "ul",
        items: [
          "Poptávky z webu a nabídky včetně AI asistence",
          "Zaměření v terénu, fotografie a termíny montáže",
          "Úkoly pro montéry a docházka na tabletu",
          "Výroba, sklad materiálu a stav ve dílně",
          "Vícepráce, zálohy a fakturace",
          "Komunikace se zákazníkem a zákaznický portál",
        ],
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
    relatedSlugs: ["fakturace-a-doklady", "rizeni-zakazek"],
  },
  {
    slug: LEGAL_TERMS.slug,
    title: "RAJMONDATA | Obchodní podmínky služby",
    description: "Všeobecné obchodní podmínky používání platformy RAJMONDATA (B2B SaaS).",
    h1: LEGAL_TERMS.title,
    kind: "legal",
    legalKey: "terms",
    breadcrumbLabel: "Obchodní podmínky",
  },
  {
    slug: LEGAL_PRIVACY.slug,
    title: "RAJMONDATA | Zásady ochrany osobních údajů",
    description:
      "Zásady ochrany osobních údajů, informace k GDPR, role správce a zpracovatele a smlouva o zpracování (DPA).",
    h1: LEGAL_PRIVACY.title,
    kind: "legal",
    legalKey: "privacy",
    breadcrumbLabel: "Ochrana osobních údajů",
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
    title: "RAJMONDATA | Smlouva o zpracování osobních údajů (DPA)",
    description: "Smlouva o zpracování osobních údajů podle čl. 28 GDPR pro zákaznické organizace.",
    h1: "Smlouva o zpracování osobních údajů",
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
  return MARKETING_PAGES.filter(
    (p) =>
      p.slug !== LEGACY_GDPR_SLUG && (p.kind !== "legal" || p.legalKey !== "dpa")
  );
}

/** DPA stránka je právní příloha — ve sitemap ji neuvádíme. */
export const PUBLIC_SITEMAP_SLUGS = getIndexableMarketingPages().map((p) => p.slug);
