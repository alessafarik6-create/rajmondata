import { PORTAL_SIDEBAR_MENU_DEFS } from "@/lib/portal-menu-config";
import type { ProductDemoStep } from "@/lib/ai-tutor/product-demo-script";

const NARRATION: Record<string, string> = {
  overview:
    "Přehled firmy shrnuje zakázky, finance a upozornění — vedení má vše na první obrazovce.",
  employees: "Zaměstnanci, role a oprávnění — kdo smí fakturovat, schvalovat docházku nebo vidět GPS.",
  labor: "Práce a mzdy propojí docházku, výkazy a mzdové podklady pro účetní.",
  customers: "Zákazníci a kontakty — historie zakázek, smluv a komunikace na jednom místě.",
  jobs: "Zakázky vedou celý obchodní proces od poptávky po dokončení a fakturaci.",
  schedule: "Kalendář ukáže montáže, kapacity týmu a termíny u zákazníků.",
  leads: "Poptávky zachytíte z webu, e-mailu nebo telefonu a rychle je převedete na zakázku.",
  offers: "Nabídky a kalkulace — RAJMONDATA EDITOR nebo šablony pro opakované práce.",
  productCatalogs: "Produktové katalogy zrychlí tvorbu nabídek a fakturace materiálu.",
  customerChats: "Zákaznické chaty propojí tým se zákazníky bez ztráty kontextu zakázky.",
  emails: "Firemní e-mail v portálu — odesílání smluv a faktur přímo ze zakázky.",
  meetingRecords: "Schůzky a zápisy — co jste domluvili se zákazníkem zůstane u zakázky.",
  finance: "Finance dávají přehled cash-flow, nákladů a propojení s bankou.",
  bank: "Banka páruje platby s fakturami a šetří ruční kontrolu účtenek.",
  invoices: "Faktury — zálohy, daňové doklady a export pro účetní.",
  documents: "Doklady a smlouvy v jedné knihovně s verzováním a odesláním e-mailem.",
  sklad: "Sklad materiálu — naskladnění, výdej na zakázku a inventura.",
  vyroba: "Výroba sleduje zakázky ve výrobě, operace a kapacity.",
  fleet: "Vozový park a GPS mapa — kde jsou auta a kdo jede na montáž.",
  cameras: "Kamery na stavbách nebo v halách doplňují dohled nad zakázkami.",
  reports: "Reporty a exporty pro vedení firmy i účetní.",
  activity: "Aktivita v systému — kdo co změnil a kdy.",
  billing: "Předplatné a licence modulů pro vaši firmu.",
  chat: "Interní chat týmu u zakázek a zákazníků.",
  help: "Nápověda a průvodci — právě je používáte v AI asistentovi.",
  settings: "Nastavení firmy, branding a integrace.",
  aiCenter: "AI centrum — sekretářka, knowledge base a chytré nástroje pro firmu.",
};

const DEMO_PANEL_BY_ID: Record<string, string> = {
  overview: "dashboard",
  jobs: "jobs",
  customers: "customers",
  employees: "team",
  labor: "team",
  emails: "email",
  invoices: "invoices",
  finance: "finance",
  sklad: "warehouse",
  vyroba: "production",
  fleet: "gps",
  aiCenter: "email",
};

/** Moduly pro podrobnou prohlídku (bez employee-only položek). */
const DETAILED_IDS = [
  "overview",
  "employees",
  "labor",
  "customers",
  "jobs",
  "schedule",
  "leads",
  "offers",
  "productCatalogs",
  "customerChats",
  "emails",
  "meetingRecords",
  "finance",
  "bank",
  "invoices",
  "documents",
  "sklad",
  "vyroba",
  "fleet",
  "cameras",
  "reports",
  "activity",
  "aiCenter",
] as const;

export function buildDetailedDemoSteps(): ProductDemoStep[] {
  const defs = PORTAL_SIDEBAR_MENU_DEFS.filter((d) =>
    (DETAILED_IDS as readonly string[]).includes(d.id)
  );
  const ordered = DETAILED_IDS.map((id) => defs.find((d) => d.id === id)).filter(Boolean);

  const chapters: ProductDemoStep[] = ordered.map((d, i) => {
    const label = d!.label;
    const narration =
      NARRATION[d!.id] ??
      `${label} — modul RAJMONDATA pro každodenní práci ve firmě. Ukážeme, kde ho najdete a co zde děláte.`;
    return {
      id: `detail-${d!.id}`,
      segment: `Kapitola ${i + 1}`,
      title: label,
      narration,
      durationSec: Math.min(18, Math.max(10, Math.ceil(narration.length / 12))),
      demoPanel: DEMO_PANEL_BY_ID[d!.id] ?? "dashboard",
      chapterId: d!.id,
      demoView: (DEMO_PANEL_BY_ID[d!.id] ?? "dashboard") as ProductDemoStep["demoView"],
    };
  });

  chapters.push({
    id: "detail-cta",
    segment: "Závěr",
    title: "Vyzkoušejte RAJMONDATA",
    narration:
      "Prošli jste moduly portálu. Založte si firmu zdarma a AI průvodkyně vás provede nastavením na vašich datech.",
    durationSec: 15,
    demoPanel: "cta",
    demoView: "dashboard",
  });

  return chapters;
}

export function detailedChapterLabels(): { id: string; label: string }[] {
  return buildDetailedDemoSteps()
    .filter((s) => s.chapterId)
    .map((s) => ({ id: s.chapterId!, label: s.title }));
}
