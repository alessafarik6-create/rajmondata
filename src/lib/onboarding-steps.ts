export type OnboardingStepDef = {
  id: string;
  title: string;
  description: string;
  route: string;
  targetSelector?: string | null;
  order?: number;
  enabled?: boolean;
};

/** Kroky průvodce pro nové organizace (cesty odpovídají portálu). */
export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  {
    id: "create-job",
    title: "Vytvořte první zakázku",
    description: "Klikněte na Zakázky a vytvořte první zakázku.",
    route: "/portal/jobs",
  },
  {
    id: "add-employee",
    title: "Přidejte zaměstnance",
    description: "Přidejte prvního zaměstnance.",
    route: "/portal/employees",
  },
  {
    id: "setup-attendance",
    title: "Nastavte docházku",
    description: "Založte terminál docházky.",
    route: "/portal/labor/dochazka",
  },
  {
    id: "create-invoice",
    title: "Vytvořte fakturu",
    description: "Vystavte první fakturu.",
    route: "/portal/invoices",
  },
] as const;

/** ID položky v levém menu (`PORTAL_SIDEBAR_MENU_DEFS`) pro zvýraznění. */
export function onboardingStepToNavId(stepId: string): string {
  const m: Record<string, string> = {
    "create-job": "jobs",
    "add-employee": "employees",
    "setup-attendance": "labor",
    "create-invoice": "invoices",
  };
  return m[stepId] || "overview";
}

/** Fallback pro dynamické kroky: podle route odhadne navId. */
export function onboardingNavIdFromRoute(route: string | undefined | null): string {
  const r = String(route || "").trim();
  if (!r) return "overview";
  if (r.startsWith("/portal/jobs")) return "jobs";
  if (r.startsWith("/portal/employees")) return "employees";
  if (r.startsWith("/portal/labor")) return "labor";
  if (r.startsWith("/portal/invoices")) return "invoices";
  if (r.startsWith("/portal/finance")) return "finance";
  if (r.startsWith("/portal/documents")) return "documents";
  if (r.startsWith("/portal/vyuctovani")) return "vyuctovani";
  if (r.startsWith("/portal/billing")) return "billing";
  if (r.startsWith("/portal/settings")) return "settings";
  if (r.startsWith("/portal/help")) return "help";
  return "overview";
}
