export type EmployeeDocumentType =
  | "employment_contract"
  | "dpp"
  | "dpc"
  | "agreement_other"
  | "addendum"
  | "personal_id"
  | "photo"
  | "other";

export type EmployeeDocumentStatus =
  | "draft"
  | "waiting_employee_signature"
  | "waiting_company_signature"
  | "signed_both";

export type EmployeeDocumentDoc = {
  id: string;
  companyId: string;
  employeeId: string;
  title: string;
  type: EmployeeDocumentType;
  fileUrl: string;
  storagePath: string;
  contentType?: string;
  note?: string;

  status: EmployeeDocumentStatus;
  /** Audit */
  createdAt?: unknown;
  createdBy?: string;
  updatedAt?: unknown;
  updatedBy?: string;

  /** Signatures (original PDF stays) */
  employeeSignedAt?: unknown;
  employeeSignedBy?: string;
  employeeSignatureUrl?: string;
  companySignedAt?: unknown;
  companySignedBy?: string;
  companySignatureUrl?: string;
  finalSignedPdfUrl?: string;
  finalSignedStoragePath?: string;
};

export type EmployeeDocumentTemplateType =
  | "employment_contract"
  | "dpp"
  | "dpc"
  | "agreement_other";

export type EmployeeDocumentTemplateDoc = {
  id: string;
  companyId: string;
  title: string;
  type: EmployeeDocumentTemplateType;
  content: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string;
  updatedBy?: string;
};

export const EMPLOYEE_DOC_TYPE_LABEL: Record<EmployeeDocumentType, string> = {
  employment_contract: "Pracovní smlouva",
  dpp: "DPP",
  dpc: "DPČ",
  agreement_other: "Dohoda / jiný dokument",
  addendum: "Dodatek",
  personal_id: "Osobní doklad",
  photo: "Fotodokumentace",
  other: "Ostatní",
};

export function isEmployeeDocContractLike(t: EmployeeDocumentType): boolean {
  return (
    t === "employment_contract" ||
    t === "dpp" ||
    t === "dpc" ||
    t === "agreement_other" ||
    t === "addendum"
  );
}

