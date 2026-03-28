/**
 * Firestore: companies/{companyId}/jobs/{jobId}/expenses/{expenseId}
 */

export type JobExpenseFileType = "image" | "pdf" | "office";

/** Pole uložená v dokumentu nákladu (id přidává klient z useCollection). */
export type JobExpenseFirestoreFields = {
  companyId: string;
  jobId: string;
  /** Hodnota zadaná uživatelem (význam podle `amountType`). */
  amountInput?: number;
  /** Zda je `amountInput` bez DPH nebo s DPH. */
  amountType?: "net" | "gross";
  /** Částka bez DPH; pro kompatibilitu synchronizovaná s `amount`. */
  amountNet?: number;
  /** @deprecated Používejte amountNet — zachováno pro starší klienty. */
  amount: number;
  /** Sazba DPH v procentech: 0, 12, 21 */
  vatRate?: number;
  vatAmount?: number;
  amountGross?: number;
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
  /** Např. `folder_documents` — náklad z účetní složky; `daily_work_report` — schválený výkaz práce. */
  source?: string;
  /** ID dokumentu daily_work_reports (např. employeeId__yyyy-MM-dd). */
  sourceReportId?: string;
  /** Index řádku v poli segmentJobSplits. */
  sourceReportRowIndex?: number;
  sourceEmployeeId?: string;
  workReportHours?: number;
  workReportHourlyRateCzk?: number;
  /** companies/.../documents/{id} — primární doklad (ne zrcadlo jobExpense_*). */
  dokladId?: string;
  folderId?: string;
  folderImageId?: string;
};

export type JobExpenseRow = { id: string } & Partial<JobExpenseFirestoreFields>;
