/**
 * Lokální nápověda pro asistenta portálu (bez LLM).
 * Odpovědi podle klíčových slov a aktuální cesty.
 */

export type PortalAssistantReply = {
  text: string;
  /** Cíl tlačítka „Otevřít tuto sekci“ (uvnitř /portal/…). */
  openHref?: string;
  openLabel?: string;
};

export type PortalQuickQuestion = { id: string; label: string };

export const PORTAL_QUICK_QUESTIONS: PortalQuickQuestion[] = [
  { id: "job_new", label: "Jak vytvořit zakázku" },
  { id: "doc_contract", label: "Jak odeslat smlouvu" },
  { id: "production", label: "Jak funguje výroba" },
  { id: "warehouse", label: "Jak pracovat se skladem" },
  { id: "employee_new", label: "Jak přidat zaměstnance" },
  { id: "meetings", label: "Jak fungují schůzky" },
  { id: "troubleshoot", label: "Proč mi něco nefunguje" },
];

function normalizeCs(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_ID: Record<string, PortalAssistantReply> = {
  job_new: {
    text:
      "Zakázky (jobs) vytvoříte v modulu Zakázky.\n\n" +
      "1) Otevřete přehled zakázek.\n" +
      "2) Zvolte vytvoření nové zakázky (tlačítko pro nový záznam podle obrazovky).\n" +
      "3) Vyplňte název, termíny a popis; uložte.\n\n" +
      "Úprava zakázky: otevřete detail zakázky a použijte úpravy polí / záložek podle typu záznamu.\n\n" +
      "Přiřazení zákazníka: v detailu zakázky vyberte zákazníka z adresáře nebo propojte existující kontakt — záleží na tom, jak máte zakázku nastavenou v CRM části aplikace.",
    openHref: "/portal/jobs",
    openLabel: "Otevřít zakázky",
  },
  doc_contract: {
    text:
      "Odeslání smlouvy obvykle probíhá z modulu Dokumenty.\n\n" +
      "1) Najděte dokument / šablonu smlouvy u zakázky nebo v dokumentech.\n" +
      "2) Ověřte vyplněná pole a podpisové údaje.\n" +
      "3) Použijte akci pro odeslání (e-mailem odkaz / podpisový nástroj podle vaší konfigurace).\n\n" +
      "PDF: často se generuje tlačítkem „PDF“ nebo „Stáhnout / Náhled“ u dokumentu.\n\n" +
      "Pokud odeslání selže, zkontrolujte přihlášení, oprávnění k zakázce a konfiguraci e-mailu u organizace.",
    openHref: "/portal/documents",
    openLabel: "Otevřít dokumenty",
  },
  production: {
    text:
      "Výroba slouží k práci výrobního týmu u zakázek bez citlivých finančních údajů.\n\n" +
      "Zahájení výroby: v detailu výrobní zakázky použijte „Zahájit výrobu“ — uloží se čas, uživatel a aktivní stav výroby.\n\n" +
      "Výdej materiálu: ve výrobě vyberte skladovou položku, zadejte množství a potvrďte výdej na zakázku. U délkových materiálů lze odebrat část; zbytek se eviduje jako nová skladová řádka.\n\n" +
      "Zbytky: po částečném řezu vznikne zbytek ve skladu; lze ho znovu vybrat při další výrobě.\n\n" +
      "Výrobní podklady (plánky, PDF, fotky) jsou u zakázky ve složkách — administrátor může označit složky jako viditelné pro výrobu.",
    openHref: "/portal/vyroba",
    openLabel: "Otevřít výrobu",
  },
  warehouse: {
    text:
      "Sklad eviduje položky, pohyby a zásoby.\n\n" +
      "Naskladnění: přidejte příjem zboží / materiálu (příjemka, typ pohybu „do skladu“ podle obrazovky).\n\n" +
      "Vyskladnění: výdej na zakázku, interní převod nebo výdej ve výrobě — vždy zapište množství a jednotku.\n\n" +
      "Délka materiálu: u položek v režimu délky zadávejte délku ve skladové jednotce (mm, m, …) podle nastavení položky; při výrobě lze zadat vstup v mm/cm/m, pokud to položka umožňuje.\n\n" +
      "Oprávnění ke skladu mají role vedení nebo zaměstnanci s přístupem ke skladu v kartě zaměstnance.",
    openHref: "/portal/sklad",
    openLabel: "Otevřít sklad",
  },
  employee_new: {
    text:
      "Zaměstnance přidáte v sekci Zaměstnanci.\n\n" +
      "1) Vytvořte záznam zaměstnance (jméno, role, kontakt).\n" +
      "2) Propojte účet (e-mail / pozvánka) podle postupu v aplikaci.\n" +
      "3) Nastavte moduly: docházka, sklad, výroba apod. podle toho, co smí používat.\n\n" +
      "Docházka: zaměstnanec může vyplňovat denní výkazy nebo docházku v zaměstnaneckém portálu, pokud má modul zapnutý.\n\n" +
      "PIN terminál: v administraci najděte nastavení terminálu / PIN přístupu pro docházkové hodiny (sekce Labor / terminál podle vaší verze).",
    openHref: "/portal/employees",
    openLabel: "Otevřít zaměstnance",
  },
  meetings: {
    text:
      "Schůzky (zápisy schůzek) slouží k evidenci jednání.\n\n" +
      "Vytvoření záznamu: v modulu zápisů schůzek zvolte nový záznam, vyplňte datum, účastníky a obsah.\n\n" +
      "Přiřazení k zakázce: v záznamu vyberte související zakázku nebo odkaz, pokud formulář nabízí propojení.\n\n" +
      "Sdílení zákazníkovi: použijte funkci sdílení / odkazu pro externího klienta, pokud je v záznamu k dispozici (záleží na nastavení a oprávněních).",
    openHref: "/portal/meeting-records",
    openLabel: "Otevřít schůzky",
  },
  troubleshoot: {
    text:
      "Obecný postup, když „něco nejde“:\n\n" +
      "1) Obnovte stránku (F5) a zkuste znovu po přihlášení.\n" +
      "2) Zkontrolujte roli a oprávnění — některé moduly vyžadují vlastníka, admina nebo příznak u zaměstnance.\n" +
      "3) PDF / odeslání: ověřte, že je dokument uložený, neblokuje ho validace a že máte aktivní licenci / modul.\n" +
      "4) Data se nezobrazují: zkuste jiný filtr data, zkontrolujte přiřazení k firmě a Firestore pravidla.\n" +
      "5) Chyba Firestore index: v konzoli bývá odkaz „Create index“ — index je potřeba vytvořit ve Firebase a počkat na dokončení.\n" +
      "6) Deploy chyba: otevřete log buildu (Vercel / CI), hledejte TypeScript nebo chybějící env proměnné.\n\n" +
      "Jste-li na konkrétní stránce, napište co přesně děláte (např. „výdej materiálu ve výrobě“) — asistent vám vybere užší návod podle textu.",
    openHref: "/portal/dashboard",
    openLabel: "Otevřít přehled",
  },
};

function routeContextSuffix(pathname: string): string {
  const p = pathname || "";
  if (p.startsWith("/portal/vyroba")) {
    return "\n\nAktuálně jste ve výrobě — u detailu zakázky hledejte zahájení výroby, podklady nahoře a blok „Materiál“ pro výdej.";
  }
  if (p.startsWith("/portal/sklad")) {
    return "\n\nAktuálně jste ve skladu — pohyby a položky upravujte v příslušných záložkách přehledu skladu.";
  }
  if (p.startsWith("/portal/documents")) {
    return "\n\nAktuálně jste v dokumentech — smlouvy a PDF obvykle najdete v seznamu dokumentů u zakázky nebo v tomto modulu.";
  }
  if (p.startsWith("/portal/jobs")) {
    return "\n\nAktuálně jste u zakázek — nová zakázka je z přehledu přes tlačítko pro vytvoření záznamu.";
  }
  if (p.startsWith("/portal/invoices")) {
    return "\n\nAktuálně jste u faktur — nová faktura včetně záloh se zakládá z přehledu faktur.";
  }
  if (p.startsWith("/portal/meeting-records")) {
    return "\n\nAktuálně jste u zápisů schůzek — nový záznam přes tlačítko pro vytvoření.";
  }
  if (p.startsWith("/portal/employees") || p.startsWith("/portal/labor")) {
    return "\n\nAktuálně jste u zaměstnanců nebo docházky — nastavení PIN/terminálu bývá v laboratoři / terminálu.";
  }
  return "";
}

function matchKeywords(n: string): PortalAssistantReply | null {
  if (
    /(faktur|zaloh|zalohov|variabil|vs|dic|danovy doklad)/.test(n)
  ) {
    return {
      text:
        "Faktury zakládáte v modulu Faktury.\n\n" +
        "Nová faktura: z přehledu zvolte vytvoření faktury, doplňte odběratele, položky, datum splatnosti.\n\n" +
        "Zálohová faktura: při vytváření zvolte typ zálohy / zálohový doklad podle formuláře (záloha vs. daňový doklad závisí na nastavení).\n\n" +
        "Variabilní symbol: často se předvyplní z čísla faktury nebo ho zadejte ručně podle vaší účetní politiky; zkontrolujte ho před odesláním klientovi.",
      openHref: "/portal/invoices",
      openLabel: "Otevřít faktury",
    };
  }
  if (/(sklad|nasklad|vysklad|inventar|material|zasob)/.test(n)) {
    return { ...BY_ID.warehouse };
  }
  if (/(vyrob|material na zakaz|zbytek|rez|vydej)/.test(n)) {
    return { ...BY_ID.production };
  }
  if (/(dokument|smlouv|pdf|odeslat|podpis)/.test(n)) {
    return { ...BY_ID.doc_contract };
  }
  if (/(schuz|schuzk|zapis schuz|meeting)/.test(n)) {
    return { ...BY_ID.meetings };
  }
  if (/(zamestnan|personal|dochaz|vykaz|pin|terminal)/.test(n)) {
    return { ...BY_ID.employee_new };
  }
  if (/(zakaz|job|zakon)/.test(n) && !/vyrob/.test(n)) {
    return { ...BY_ID.job_new };
  }
  if (/(pdf|nejde|odeslat|email|neodesl)/.test(n)) {
    return {
      text:
        "Když PDF nejde odeslat:\n\n" +
        "• Uložte všechny povinné pole a zkuste znovu vygenerovat PDF.\n" +
        "• Ověřte přihlášení a oprávnění k zakázce / dokumentu.\n" +
        "• Zkontrolujte, zda má firma nastavený odesílající e-mail a šablonu.\n" +
        "• V konzoli prohlížeče (F12) hledejte chybu sítě nebo 403 z API.\n\n" +
        "Dokumenty a smlouvy upravujte v modulu Dokumenty.",
      openHref: "/portal/documents",
      openLabel: "Otevřít dokumenty",
    };
  }
  if (/(index|firestore|composite)/.test(n)) {
    return {
      text:
        "Chyba Firestore „index“: databáze vyžaduje složený index pro dotaz.\n\n" +
        "1) V chybové hlášce (konzole / toast) klikněte na odkaz pro vytvoření indexu ve Firebase Console.\n" +
        "2) Po vytvoření počkejte několik minut, než se index „zbuildí“.\n" +
        "3) Obnovte stránku a zkuste dotaz znovu.\n\n" +
        "Bez dokončeného indexu se seznam dat nemusí načíst.",
      openHref: "/portal/dashboard",
      openLabel: "Zpět na přehled",
    };
  }
  if (/(deploy|build|vercel|pipeline|ci)/.test(n)) {
    return {
      text:
        "Deploy / build chyba: otevřete log posledního nasazení (např. Vercel → Deployments → failed build).\n\n" +
        "Časté příčiny: TypeScript chyba, chybějící proměnná prostředí, import server-only knihoven do klientského kódu.\n\n" +
        "Opravte chybu lokálně (`npm run build`), commitněte a pushtěte znovu.",
      openHref: "/portal/dashboard",
      openLabel: "Otevřít přehled",
    };
  }
  if (/(nezobraz|prazdn|neprid|missing|data)/.test(n)) {
    return {
      text:
        "Když se data nezobrazují:\n\n" +
        "• Zkontrolujte filtry (datum, stav, přiřazení).\n" +
        "• Ověřte, že jste přihlášeni pod správnou firmou (companyId v profilu).\n" +
        "• U zaměstnance zkontrolujte příznaky modulů (např. výroba, sklad).\n" +
        "• V konzoli hledejte 403 (pravidla Firestore) nebo chybějící index.\n\n" +
        "Obnovení stránky často pomůže po opravě pravidel nebo indexů.",
      openHref: "/portal/dashboard",
      openLabel: "Otevřít přehled",
    };
  }
  return null;
}

/**
 * Vrátí odpověď asistenta podle otázky a aktuální cesty v aplikaci.
 */
export function getPortalAssistantReply(rawQuestion: string, pathname: string): PortalAssistantReply {
  const trimmed = String(rawQuestion || "").trim();
  const n = normalizeCs(trimmed);

  const quick = PORTAL_QUICK_QUESTIONS.find((q) => normalizeCs(q.label) === n || q.label === trimmed);
  if (quick && BY_ID[quick.id]) {
    const base = BY_ID[quick.id];
    return {
      ...base,
      text: base.text + routeContextSuffix(pathname),
    };
  }

  const kw = matchKeywords(n);
  if (kw) {
    return {
      ...kw,
      text: kw.text + routeContextSuffix(pathname),
    };
  }

  if (!n) {
    return {
      text:
        "Napište krátkou otázku nebo zvolte jednu z rychlých otázek nahoře. Podle textu a stránky, na které jste, doporučím konkrétní modul.",
      openHref: "/portal/dashboard",
      openLabel: "Přehled portálu",
    };
  }

  return {
    text:
      "Na tuto formulaci nemám přesný návod. Zkuste:\n\n" +
      "• jednu z rychlých otázek nahoře,\n" +
      "• nebo napište konkrétněji (např. „zálohová faktura“, „Firestore index“, „výdej materiálu ve výrobě“).\n\n" +
      "Podle cesty v aplikaci vám napovím i kontext aktuální sekce." +
      routeContextSuffix(pathname),
    openHref: "/portal/dashboard",
    openLabel: "Otevřít přehled",
  };
}
