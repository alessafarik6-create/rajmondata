export type ProductDemoInterest =
  | "jobs"
  | "team"
  | "finance"
  | "production"
  | "full";

export type ProductDemoMode = "quick" | "detailed";

export type DemoView =
  | "dashboard"
  | "jobs-list"
  | "jobs-form"
  | "job-detail"
  | "contract"
  | "email-compose"
  | "customers"
  | "team"
  | "email-ai"
  | "invoices"
  | "finance"
  | "warehouse"
  | "production"
  | "gps"
  | "cta";

export type DemoHighlight =
  | "nav-jobs"
  | "btn-new-job"
  | "field-customer"
  | "btn-save-job"
  | "btn-contract"
  | "btn-send-email"
  | "nav-team"
  | "nav-email"
  | "nav-invoices"
  | "nav-warehouse"
  | "nav-fleet"
  | "ai-widget";

export type ProductDemoStep = {
  id: string;
  segment: string;
  title: string;
  narration: string;
  /** Doporučená délka segmentu v sekundách (celkem ~120 s u rychlé prohlídky). */
  durationSec: number;
  demoPanel: string;
  tourTarget?: string;
  demoView?: DemoView;
  highlight?: DemoHighlight;
  /** Pro podrobnou prohlídku — skok na kapitolu. */
  chapterId?: string;
};

export const PRODUCT_DEMO_STEPS: ProductDemoStep[] = [
  {
    id: "intro",
    segment: "0–15 s",
    title: "RAJMONDATA v kostce",
    narration:
      "RAJMONDATA je český firemní portál pro montážní a stavební firmy — zakázky, lidé, finance a AI na jednom místě.",
    durationSec: 15,
    demoPanel: "overview",
    demoView: "dashboard",
  },
  {
    id: "jobs-intro",
    segment: "15–25 s",
    title: "Zakázky — začátek",
    narration: "Podívejte se, jak jednoduše vytvoříte novou zakázku. Otevřu modul Zakázky v levém menu.",
    durationSec: 10,
    demoPanel: "jobs",
    demoView: "dashboard",
    highlight: "nav-jobs",
  },
  {
    id: "jobs",
    segment: "25–45 s",
    title: "Nová zakázka",
    narration:
      "Kliknu na Nová zakázka, vyplním ukázkového zákazníka a název zakázky. Vše uložím — data zůstávají jen v demu.",
    durationSec: 20,
    demoPanel: "jobs",
    tourTarget: "demo-jobs-list",
    demoView: "jobs-form",
    highlight: "btn-new-job",
  },
  {
    id: "jobs-contract",
    segment: "45–60 s",
    title: "Smlouva o dílo",
    narration:
      "Ze zakázky vytvořím smlouvu o dílo jedním kliknutím a připravím PDF pro zákazníka.",
    durationSec: 15,
    demoPanel: "jobs",
    demoView: "contract",
    highlight: "btn-contract",
  },
  {
    id: "jobs-email",
    segment: "60–75 s",
    title: "Odeslání e-mailem",
    narration: "Nakonec ukážu připravený e-mail se smlouvou v příloze — odeslání je bezpečně simulované.",
    durationSec: 15,
    demoPanel: "jobs",
    demoView: "email-compose",
    highlight: "btn-send-email",
  },
  {
    id: "team",
    segment: "40–60 s",
    title: "Tým a docházka",
    narration: "Zaměstnanci, role, oprávnění a docházka — kdo kde pracuje a co smí v portálu dělat.",
    durationSec: 20,
    demoPanel: "team",
    tourTarget: "demo-team",
    demoView: "team",
    highlight: "nav-team",
  },
  {
    id: "email-ai",
    segment: "75–95 s",
    title: "E-mail a AI sekretářka",
    narration: "Firemní schránka a AI sekretářka — odpovědi, shrnutí a rychlé akce bez přepínání systémů.",
    durationSec: 20,
    demoPanel: "email",
    tourTarget: "demo-ai",
    demoView: "email-ai",
    highlight: "nav-email",
  },
  {
    id: "ops",
    segment: "95–110 s",
    title: "Finance, sklad a GPS",
    narration: "Fakturace, sklad materiálu a živá poloha vozidel z GPS — přehled pro vedení firmy.",
    durationSec: 15,
    demoPanel: "ops",
    tourTarget: "demo-ops",
    demoView: "gps",
    highlight: "nav-fleet",
  },
  {
    id: "cta",
    segment: "100–120 s",
    title: "Vyzkoušejte na vlastní firmě",
    narration:
      "Teď už víte, co RAJMONDATA umí. Založte si firmu zdarma a AI průvodkyně vás provede nastavením krok za krokem.",
    durationSec: 20,
    demoPanel: "cta",
    demoView: "dashboard",
  },
];

export function orderDemoStepsForInterest(interest: ProductDemoInterest): ProductDemoStep[] {
  const base = [...PRODUCT_DEMO_STEPS];
  if (interest === "full") return base;
  const intro = base.find((s) => s.id === "intro")!;
  const cta = base.find((s) => s.id === "cta")!;
  const mid = base.filter((s) => s.id !== "intro" && s.id !== "cta");
  const priority: Record<ProductDemoInterest, string[]> = {
    full: [],
    jobs: ["jobs-intro", "jobs", "jobs-contract", "jobs-email", "email-ai", "ops", "team"],
    team: ["team", "jobs-intro", "jobs", "email-ai", "ops"],
    finance: ["ops", "jobs-intro", "jobs", "email-ai", "team"],
    production: ["ops", "jobs-intro", "team", "email-ai"],
  };
  const order = priority[interest];
  const sorted = order
    .map((id) => mid.find((s) => s.id === id))
    .filter(Boolean) as ProductDemoStep[];
  return [intro, ...sorted, cta];
}

export function quickDemoSteps(interest: ProductDemoInterest = "full"): ProductDemoStep[] {
  return orderDemoStepsForInterest(interest);
}
