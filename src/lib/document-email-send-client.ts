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
  invoiceId?: string | null;
  contractId?: string | null;
};

export async function sendJobDocumentEmailFromBrowser(
  payload: SendJobDocumentEmailPayload
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) return { ok: false, error: "Nejste přihlášeni." };
  const token = await user.getIdToken();
  const res = await fetch(apiUrl("/api/company/document-email/send"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j.ok) {
    return { ok: false, error: j.error || `Chyba ${res.status}` };
  }
  return { ok: true };
}
