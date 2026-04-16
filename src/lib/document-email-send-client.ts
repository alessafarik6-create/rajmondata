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

export type SendJobDocumentEmailResult =
  | { ok: true }
  | { ok: false; error: string; detail: string | null };

export async function sendJobDocumentEmailFromBrowser(
  payload: SendJobDocumentEmailPayload
): Promise<SendJobDocumentEmailResult> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) return { ok: false, error: "Nejste přihlášeni.", detail: null };
  const token = await user.getIdToken();
  const res = await fetch(apiUrl("/api/company/document-email/send"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const rawText = await res.text();
  let parsed: { ok?: boolean; error?: string; detail?: string | null } = {};
  try {
    parsed = JSON.parse(rawText) as typeof parsed;
  } catch {
    parsed = {};
  }

  const logBody =
    rawText.length > 16_000 ? `${rawText.slice(0, 16_000)}… (truncated, len=${rawText.length})` : rawText;
  console.info("[document-email/send] API response", {
    status: res.status,
    ok: parsed.ok,
    error: parsed.error,
    detailLen: parsed.detail != null ? String(parsed.detail).length : 0,
  });
  console.info("[document-email/send] API response body", logBody);

  if (!res.ok || !parsed.ok) {
    const error = (parsed.error != null && String(parsed.error).trim() !== ""
      ? String(parsed.error).trim()
      : `HTTP ${res.status}`) as string;
    const detail =
      parsed.detail != null && String(parsed.detail).trim() !== ""
        ? String(parsed.detail).trim()
        : null;
    return { ok: false, error, detail };
  }
  return { ok: true };
}
