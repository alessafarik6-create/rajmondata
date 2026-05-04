/**
 * Lokální persist „Materiál pro zakázku“ (výrobní workbench).
 * Klíč: productionDraft_{organizationId}_{jobId}
 */

const DRAFT_V = 1 as const;

export type ProductionMaterialDraftLine = {
  key: string;
  itemId: string;
  qtyStr: string;
  repeatCountStr: string;
  note: string;
  batchNumber: string;
  inputLengthUnit: "mm" | "cm" | "m" | null;
  productionDrawingKey?: string | null;
};

export type ProductionMaterialDraftV1 = {
  v: typeof DRAFT_V;
  savedAt: number;
  issueQueue: ProductionMaterialDraftLine[];
  attachDrawingToExport: boolean;
  a4IncludeUnassigned: boolean;
};

export function productionMaterialDraftStorageKey(organizationId: string, jobId: string): string {
  return `productionDraft_${organizationId}_${jobId}`;
}

export function loadProductionMaterialDraft(
  organizationId: string,
  jobId: string
): ProductionMaterialDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(productionMaterialDraftStorageKey(organizationId, jobId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProductionMaterialDraftV1;
    if (!parsed || parsed.v !== DRAFT_V || !Array.isArray(parsed.issueQueue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveProductionMaterialDraft(
  organizationId: string,
  jobId: string,
  draft: Omit<ProductionMaterialDraftV1, "v" | "savedAt"> & { savedAt?: number }
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: ProductionMaterialDraftV1 = {
      v: DRAFT_V,
      savedAt: draft.savedAt ?? Date.now(),
      issueQueue: draft.issueQueue,
      attachDrawingToExport: draft.attachDrawingToExport,
      a4IncludeUnassigned: draft.a4IncludeUnassigned,
    };
    window.localStorage.setItem(
      productionMaterialDraftStorageKey(organizationId, jobId),
      JSON.stringify(payload)
    );
  } catch {
    /* quota / private mode */
  }
}

export function clearProductionMaterialDraft(organizationId: string, jobId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(productionMaterialDraftStorageKey(organizationId, jobId));
  } catch {
    /* ignore */
  }
}
