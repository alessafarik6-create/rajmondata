export type OnboardingStepDef = {
  id: string;
  title: string;
  description: string;
  route: string;
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
