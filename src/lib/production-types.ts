export type ProductionStatus = "new" | "ready" | "in_progress" | "done";

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  new: "Nová",
  ready: "Připraveno",
  in_progress: "Ve výrobě",
  done: "Hotovo",
};

export type ProductionMaterialLine = {
  movementId: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  addedAt: string;
  /** Firebase Auth uid — kdo provedl vyskladnění do výroby. */
  addedBy?: string;
};

export type ProductionRecordRow = {
  id: string;
  companyId: string;
  title: string;
  jobId?: string | null;
  jobName?: string | null;
  status: ProductionStatus;
  note?: string | null;
  materials: ProductionMaterialLine[];
  createdAt?: unknown;
  createdBy: string;
  updatedAt?: unknown;
};

export type ProductionAttachmentRow = {
  id: string;
  companyId: string;
  productionId: string;
  fileUrl: string;
  fileName: string;
  fileType?: string | null;
  mimeType?: string | null;
  storagePath?: string | null;
  note?: string | null;
  createdAt?: unknown;
  createdBy: string;
};
