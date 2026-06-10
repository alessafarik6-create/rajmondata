/**
 * Pořadí a stav rozbalení sekcí detailu zakázky (localStorage).
 */

export const JOB_DETAIL_COLLAPSIBLE_SECTION_IDS = [
  "meeting_records",
  "customer_tasks",
  "cutting_plan",
  "financial",
  "document_email",
  "material_orders",
  "production_team",
  "contract_deposit",
  "expenses",
  "product_catalogs",
] as const;

export type JobDetailCollapsibleSectionId =
  (typeof JOB_DETAIL_COLLAPSIBLE_SECTION_IDS)[number];

export const JOB_DETAIL_COLLAPSIBLE_SECTION_LABELS: Record<
  JobDetailCollapsibleSectionId,
  string
> = {
  meeting_records: "Záznamy ze schůzek",
  customer_tasks: "Úkoly zákazníka a dotazník",
  cutting_plan: "Nářezový plánek / Excel",
  financial: "Finanční údaje",
  document_email: "Odeslání dokumentu e-mailem",
  material_orders: "Materiál a objednávky",
  production_team: "Výroba – přiřazení a viditelnost",
  contract_deposit: "Smlouva a zálohy",
  expenses: "Náklady zakázky",
  product_catalogs: "Produktové katalogy pro zákazníka",
};

const ORDER_STORAGE_KEY = "rajmon:job-detail-sections-order:v1";
const OPEN_STORAGE_PREFIX = "rajmon:job-detail-sections-open:v1:";

function isSectionId(value: string): value is JobDetailCollapsibleSectionId {
  return (JOB_DETAIL_COLLAPSIBLE_SECTION_IDS as readonly string[]).includes(value);
}

export function defaultJobDetailSectionOrder(): JobDetailCollapsibleSectionId[] {
  return [...JOB_DETAIL_COLLAPSIBLE_SECTION_IDS];
}

export function readJobDetailSectionOrder(
  userId: string | null | undefined
): JobDetailCollapsibleSectionId[] {
  if (typeof window === "undefined" || !userId?.trim()) {
    return defaultJobDetailSectionOrder();
  }
  try {
    const raw = localStorage.getItem(`${ORDER_STORAGE_KEY}:${userId.trim()}`);
    if (!raw) return defaultJobDetailSectionOrder();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultJobDetailSectionOrder();
    const ids = parsed.filter((x): x is JobDetailCollapsibleSectionId =>
      typeof x === "string" && isSectionId(x)
    );
    const missing = JOB_DETAIL_COLLAPSIBLE_SECTION_IDS.filter((id) => !ids.includes(id));
    return [...ids, ...missing];
  } catch {
    return defaultJobDetailSectionOrder();
  }
}

export function writeJobDetailSectionOrder(
  userId: string | null | undefined,
  order: JobDetailCollapsibleSectionId[]
): void {
  if (typeof window === "undefined" || !userId?.trim()) return;
  try {
    localStorage.setItem(`${ORDER_STORAGE_KEY}:${userId.trim()}`, JSON.stringify(order));
  } catch {
    /* ignore quota */
  }
}

export function readJobDetailSectionOpenMap(
  userId: string | null | undefined,
  jobId: string
): Partial<Record<JobDetailCollapsibleSectionId, boolean>> {
  if (typeof window === "undefined" || !userId?.trim() || !jobId.trim()) return {};
  try {
    const raw = localStorage.getItem(`${OPEN_STORAGE_PREFIX}${userId.trim()}:${jobId.trim()}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<JobDetailCollapsibleSectionId, boolean>> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isSectionId(k) && typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeJobDetailSectionOpenMap(
  userId: string | null | undefined,
  jobId: string,
  map: Partial<Record<JobDetailCollapsibleSectionId, boolean>>
): void {
  if (typeof window === "undefined" || !userId?.trim() || !jobId.trim()) return;
  try {
    localStorage.setItem(
      `${OPEN_STORAGE_PREFIX}${userId.trim()}:${jobId.trim()}`,
      JSON.stringify(map)
    );
  } catch {
    /* ignore */
  }
}

export function sortSectionsByOrder<T extends { id: JobDetailCollapsibleSectionId }>(
  sections: T[],
  order: JobDetailCollapsibleSectionId[]
): T[] {
  const map = new Map(sections.map((s) => [s.id, s]));
  const out: T[] = [];
  for (const id of order) {
    const row = map.get(id);
    if (row) out.push(row);
  }
  for (const row of sections) {
    if (!out.includes(row)) out.push(row);
  }
  return out;
}

export function moveSectionInOrder(
  order: JobDetailCollapsibleSectionId[],
  id: JobDetailCollapsibleSectionId,
  direction: "up" | "down"
): JobDetailCollapsibleSectionId[] {
  const idx = order.indexOf(id);
  if (idx < 0) return order;
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= order.length) return order;
  const next = [...order];
  [next[idx], next[swap]] = [next[swap], next[idx]];
  return next;
}
