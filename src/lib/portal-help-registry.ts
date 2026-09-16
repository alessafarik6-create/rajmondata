/**
 * Centrální index nápovědy portálu — odvozený z menu + rozšířené akce.
 */

import { PORTAL_SIDEBAR_MENU_DEFS } from "@/lib/portal-menu-config";
import type { PortalModuleId } from "@/lib/portal-permissions";
import { portalModuleIdFromPathname } from "@/lib/portal-permissions";

export type PortalHelpRegistryEntry = {
  module: PortalModuleId;
  route: string;
  title: string;
  description: string;
  actions: string[];
  keywords: string[];
  helpText: string;
  workflows?: string;
};

const EXTENSIONS: Partial<
  Record<
    PortalModuleId,
    Pick<PortalHelpRegistryEntry, "actions" | "keywords" | "helpText" | "workflows">
  >
> = {
  overview: {
    actions: ["přehled KPI", "kalendář", "úkoly", "poptávky v hodnotě"],
    keywords: ["dashboard", "prehled", "úvod"],
    helpText: "Hlavní přehled firmy — zakázky, finance, poptávky a rychlé zkratky.",
  },
  jobs: {
    actions: [
      "otevřít zakázku",
      "nová zakázka",
      "položkový rozpočet",
      "vícepráce",
      "fakturace",
      "zaměření",
      "smlouva o dílo",
      "změnit stav",
    ],
    keywords: [
      "zakazka",
      "zakázky",
      "projekt",
      "job",
      "vícepráce",
      "viceprace",
      "rozpočet",
      "zamereni",
      "zaměření",
      "mereni",
    ],
    helpText: "Zakázky a projekty — od založení po fakturaci a dokumenty.",
    workflows:
      "Poptávka → Nabídka → Zakázka → Rozpočet / vícepráce → Faktura → Doklady",
  },
  leads: {
    actions: ["import poptávek", "štítky", "nabídka z poptávky", "AI návrh nabídky"],
    keywords: ["poptavka", "poptávky", "lead", "inquiry"],
    helpText: "Importované poptávky ze webu — štítky, kontakt, nabídky.",
  },
  offers: {
    actions: ["odeslat nabídku", "šablony nabídek", "historie nabídek"],
    keywords: ["nabidka", "nabídky", "offer"],
    helpText: "Nabídky k poptávkám — e-mail, ceny, přílohy.",
  },
  invoices: {
    actions: [
      "nová faktura",
      "zálohová faktura",
      "přegenerovat PDF",
      "odeslat fakturu",
      "daňový doklad",
    ],
    keywords: ["faktura", "faktury", "záloha", "zalohova", "invoice"],
    helpText: "Vystavení a evidence faktur včetně záloh.",
  },
  documents: {
    actions: ["nahrát doklad", "smlouva", "dodatek", "odeslat k podpisu"],
    keywords: ["doklad", "doklady", "smlouva", "dodatek", "pdf"],
    helpText: "Dokumenty a smlouvy — generování, podpis, odeslání.",
  },
  employees: {
    actions: ["přidat zaměstnance", "oprávnění modulů", "role portálu"],
    keywords: ["zamestnanec", "zaměstnanec", "personal", "oprávnění"],
    helpText: "Evidence lidí a oprávnění k modulům portálu.",
  },
  labor: {
    actions: ["docházka", "výkazy", "schválení hodin", "terminál PIN"],
    keywords: ["dochazka", "mzdy", "vykaz", "prace"],
    helpText: "Práce a mzdy — docházka, výkazy, schvalování.",
  },
};

/** Sestaví registry ze sidebar definic (bez duplicitních hardcoded rout). */
export function buildPortalHelpRegistry(): PortalHelpRegistryEntry[] {
  return PORTAL_SIDEBAR_MENU_DEFS.map((def) => {
    const module = def.id as PortalModuleId;
    const ext = EXTENSIONS[module];
    return {
      module,
      route: def.href,
      title: def.label,
      description: def.label,
      actions: ext?.actions ?? [`otevřít ${def.label}`],
      keywords: ext?.keywords ?? [def.label.toLowerCase(), module],
      helpText: ext?.helpText ?? `Modul ${def.label} v portálu.`,
      workflows: ext?.workflows,
    };
  });
}

function normalizeCs(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

export function searchPortalHelpRegistry(
  question: string,
  registry: PortalHelpRegistryEntry[]
): PortalHelpRegistryEntry | null {
  const n = normalizeCs(question);
  if (!n) return null;

  let best: { entry: PortalHelpRegistryEntry; score: number } | null = null;
  for (const entry of registry) {
    let score = 0;
    for (const kw of entry.keywords) {
      const k = normalizeCs(kw);
      if (k && n.includes(k)) score += 3;
    }
    for (const act of entry.actions) {
      const a = normalizeCs(act);
      if (a && n.includes(a.replace(/\s+/g, ""))) score += 2;
    }
    if (normalizeCs(entry.title) && n.includes(normalizeCs(entry.title))) score += 4;
    if (score > 0 && (!best || score > best.score)) {
      best = { entry, score };
    }
  }
  return best && best.score >= 3 ? best.entry : null;
}

/** Kompaktní text pro LLM prompt (jen povolené moduly). */
export function serializePortalHelpForPrompt(
  registry: PortalHelpRegistryEntry[],
  currentPath: string
): string {
  const currentModule = portalModuleIdFromPathname(currentPath) ?? "overview";
  const lines: string[] = [
    `Aktuální stránka: ${currentPath} (modul ${currentModule})`,
    "",
    "Moduly portálu:",
  ];
  for (const e of registry) {
    lines.push(
      `- ${e.title} (${e.route}) [${e.module}]: ${e.helpText} Akce: ${e.actions.slice(0, 8).join("; ")}.${e.workflows ? ` Workflow: ${e.workflows}.` : ""}`
    );
  }
  return lines.join("\n");
}
