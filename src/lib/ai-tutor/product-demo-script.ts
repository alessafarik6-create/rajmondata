export type ProductDemoInterest =
  | "jobs"
  | "team"
  | "finance"
  | "production"
  | "full";

export type ProductDemoStep = {
  id: string;
  segment: string;
  title: string;
  narration: string;
  /** Doporučená délka segmentu v sekundách (celkem ~120 s). */
  durationSec: number;
  demoPanel: string;
  tourTarget?: string;
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
  },
  {
    id: "jobs",
    segment: "15–40 s",
    title: "Zakázky a smlouvy",
    narration:
      "Sledujte zakázky od poptávky po smlouvu o dílo, nabídky a odeslání dokumentů zákazníkovi e-mailem.",
    durationSec: 25,
    demoPanel: "jobs",
    tourTarget: "demo-jobs-list",
  },
  {
    id: "team",
    segment: "40–60 s",
    title: "Tým a docházka",
    narration: "Zaměstnanci, role, oprávnění a docházka — kdo kde pracuje a co smí v portálu dělat.",
    durationSec: 20,
    demoPanel: "team",
    tourTarget: "demo-team",
  },
  {
    id: "email-ai",
    segment: "60–80 s",
    title: "E-mail a AI sekretářka",
    narration: "Firemní schránka a AI sekretářka — odpovědi, shrnutí a rychlé akce bez přepínání systémů.",
    durationSec: 20,
    demoPanel: "email",
    tourTarget: "demo-ai",
  },
  {
    id: "ops",
    segment: "80–100 s",
    title: "Finance, sklad a GPS",
    narration: "Fakturace, sklad materiálu a živá poloha vozidel z GPS — přehled pro vedení firmy.",
    durationSec: 20,
    demoPanel: "ops",
    tourTarget: "demo-ops",
  },
  {
    id: "cta",
    segment: "100–120 s",
    title: "Vyzkoušejte na vlastní firmě",
    narration:
      "Teď už víte, co RAJMONDATA umí. Založte si firmu zdarma a AI průvodkyně vás provede nastavením krok za krokem.",
    durationSec: 20,
    demoPanel: "cta",
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
    jobs: ["jobs", "email-ai", "ops", "team"],
    team: ["team", "jobs", "email-ai", "ops"],
    finance: ["ops", "jobs", "email-ai", "team"],
    production: ["ops", "jobs", "team", "email-ai"],
  };
  const order = priority[interest];
  const sorted = order
    .map((id) => mid.find((s) => s.id === id))
    .filter(Boolean) as ProductDemoStep[];
  return [intro, ...sorted, cta];
}
