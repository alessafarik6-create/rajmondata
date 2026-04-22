"use client";

import { getAuth } from "firebase/auth";
import type { DocumentEmailType } from "@/lib/document-email-outbound";

function apiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export type SendJobDocumentEmailPayload = {
  companyId: string;
  jobId: string;
  type: DocumentEmailType;
  to: string;
  cc?: string;
  subject: string;
  html: string;
  documentUrl?: string | null;
  /** Pro typy, které posílají originální přílohu (např. přijatý doklad). */
  documentId?: string | null;
  invoiceId?: string | null;
  contractId?: string | null;
};

/**
 * Odešle dokument e-mailem (PDF na serveru). Při chybě vyhodí Error se zprávou z API.
 */
export async function sendJobDocumentEmailFromBrowser(
  payload: SendJobDocumentEmailPayload
): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Nejste přihlášeni.");
  }
  const token = await user.getIdToken();
  const response = await fetch(apiUrl("/api/company/document-email"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    detail?: string;
  } | null;
  console.log("document-email status", response.status);
  console.log("document-email body", data);
  if (!response.ok) {
    throw new Error(data?.error || data?.detail || `HTTP ${response.status}`);
  }
  if (data && data.ok === false) {
    throw new Error(data?.error || data?.detail || `HTTP ${response.status}`);
  }
}
