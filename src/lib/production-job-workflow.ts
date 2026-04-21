/**
 * Stav výroby u zakázky (jobs) — workflow pro výrobní tým.
 */

export const PRODUCTION_WORKFLOW_STATUSES = [
  "not_started",
  "started",
  "in_progress",
  "completed",
  "paused",
] as const;

export type ProductionWorkflowStatus = (typeof PRODUCTION_WORKFLOW_STATUSES)[number];

export const PRODUCTION_WORKFLOW_LABELS: Record<ProductionWorkflowStatus, string> = {
  not_started: "Nezahájeno",
  started: "Zahájeno",
  in_progress: "Ve výrobě",
  completed: "Dokončeno",
  paused: "Pozastaveno",
};

export function isProductionWorkflowStatus(v: string): v is ProductionWorkflowStatus {
  return (PRODUCTION_WORKFLOW_STATUSES as readonly string[]).includes(v);
}

export function parseProductionWorkflowStatus(
  job: Record<string, unknown> | null | undefined
): ProductionWorkflowStatus {
  if (!job || typeof job !== "object") return "not_started";
  const raw = job.productionWorkflowStatus;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s && isProductionWorkflowStatus(s)) return s;
  /** Zpětná kompatibilita: zahájení bez nového pole. */
  if (job.productionStartedAt != null) return "started";
  return "not_started";
}

export function canStartProductionWorkflow(status: ProductionWorkflowStatus): boolean {
  return status === "not_started" || status === "paused";
}
