/**
 * Firestore: companies/{companyId}/jobs/{jobId}/expenses/{expenseId}
 */

export type JobExpenseFileType = "image" | "pdf" | "office";

/** Pole uložená v dokumentu nákladu (id přidává klient z useCollection). */
export type JobExpenseFirestoreFields = {
  companyId: string;
  jobId: string;
  amount: number;
  date: string;
  /** Volitelná poznámka — v dokumentu může být null. */
  note?: string | null;
  fileUrl?: string | null;
  fileType?: JobExpenseFileType | null;
  fileName?: string | null;
  /** Kanonická cesta v Storage pro mazání souboru při úpravě / smazání záznamu. */
  storagePath?: string | null;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type JobExpenseRow = { id: string } & Partial<JobExpenseFirestoreFields>;
