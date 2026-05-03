import type { Firestore } from "firebase/firestore";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";

/** Stav výkresu / PDF ve výrobě — vazba zakázka + konkrétní soubor. */
export type ProductionDrawingStatusValue =
  | "unprepared"
  | "material_ready"
  | "issued"
  | "done";

export type ProductionDrawingStatusDoc = {
  jobId: string;
  /** Složený klíč odpovídající `productionPdfRows[].id` (např. folderId-fileId) */
  drawingKey: string;
  /** ID souboru ve složce (images/{id}) */
  fileId: string;
  folderId: string;
  fileName: string;
  status: ProductionDrawingStatusValue;
  materialPreparedAt?: unknown;
  materialPreparedBy?: string;
  materialPreparedByName?: string;
  issuedAt?: unknown;
  issuedBy?: string;
  issuedByName?: string;
  note?: string;
  updatedAt?: unknown;
};

export const PRODUCTION_DRAWING_STATUS_LABELS: Record<ProductionDrawingStatusValue, string> = {
  unprepared: "Nepřipraveno",
  material_ready: "Materiál připraven",
  issued: "Vyskladněno",
  done: "Hotovo",
};

export const PRODUCTION_DRAWING_STATUS_BADGE_CLASS: Record<ProductionDrawingStatusValue, string> = {
  unprepared: "bg-slate-200 text-slate-800 border border-slate-300",
  material_ready: "bg-amber-100 text-amber-950 border border-amber-300",
  issued: "bg-sky-100 text-sky-950 border border-sky-300",
  done: "bg-emerald-100 text-emerald-950 border border-emerald-300",
};

export function drawingStatusDocRef(firestore: Firestore, companyId: string, jobId: string, drawingKey: string) {
  return doc(firestore, "companies", companyId, "jobs", jobId, "productionDrawingStatus", drawingKey);
}

export function drawingStatusCollectionRef(firestore: Firestore, companyId: string, jobId: string) {
  return collection(firestore, "companies", companyId, "jobs", jobId, "productionDrawingStatus");
}

export async function upsertProductionDrawingStatus(
  firestore: Firestore,
  companyId: string,
  jobId: string,
  payload: {
    drawingKey: string;
    fileId: string;
    folderId: string;
    fileName: string;
    status: ProductionDrawingStatusValue;
    materialPreparedAt?: unknown;
    materialPreparedBy?: string | null;
    materialPreparedByName?: string | null;
    issuedAt?: unknown;
    issuedBy?: string | null;
    issuedByName?: string | null;
    note?: string;
  }
): Promise<void> {
  const ref = drawingStatusDocRef(firestore, companyId, jobId, payload.drawingKey);
  await setDoc(
    ref,
    {
      jobId,
      drawingKey: payload.drawingKey,
      fileId: payload.fileId,
      folderId: payload.folderId,
      fileName: payload.fileName,
      status: payload.status,
      ...(payload.materialPreparedAt != null ? { materialPreparedAt: payload.materialPreparedAt } : {}),
      ...(payload.materialPreparedBy ? { materialPreparedBy: payload.materialPreparedBy } : {}),
      ...(payload.materialPreparedByName ? { materialPreparedByName: payload.materialPreparedByName } : {}),
      ...(payload.issuedAt != null ? { issuedAt: payload.issuedAt } : {}),
      ...(payload.issuedBy ? { issuedBy: payload.issuedBy } : {}),
      ...(payload.issuedByName ? { issuedByName: payload.issuedByName } : {}),
      ...(payload.note != null && payload.note !== "" ? { note: payload.note } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
