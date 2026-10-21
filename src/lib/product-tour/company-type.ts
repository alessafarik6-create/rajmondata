export type CompanyType = "construction" | "installation" | "production" | "service" | "other";

export const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
  construction: "Stavební firma",
  installation: "Montážní firma",
  production: "Výrobní firma",
  service: "Servisní firma",
  other: "Jiná firma",
};

/** Pořadí zvýraznění modulů v rychlé prohlídce dle typu firmy. */
export function quickStepPriority(type: CompanyType | null): string[] {
  switch (type) {
    case "construction":
      return ["jobs-intro", "jobs", "jobs-contract", "team", "ops", "email-ai"];
    case "installation":
      return ["jobs-intro", "jobs", "email-ai", "team", "ops", "jobs-email"];
    case "production":
      return ["ops", "jobs-intro", "team", "jobs", "email-ai"];
    case "service":
      return ["email-ai", "jobs-intro", "team", "jobs", "ops"];
    default:
      return [];
  }
}
