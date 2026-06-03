import type { User } from "firebase/auth";

export async function downloadHandoverProtocolPdfFromHtml(params: {
  user: User;
  companyId: string;
  jobId: string;
  html: string;
  filename?: string;
}): Promise<Blob> {
  const token = await params.user.getIdToken();
  const res = await fetch("/api/company/handover-protocols/render-html", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      companyId: params.companyId,
      jobId: params.jobId,
      html: params.html,
      filename: params.filename,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Generování PDF se nezdařilo.");
  }
  return res.blob();
}

export async function downloadHandoverProtocolPdf(params: {
  user: User;
  companyId: string;
  protocolId: string;
}): Promise<Blob> {
  const token = await params.user.getIdToken();
  const res = await fetch("/api/company/handover-protocols/pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      companyId: params.companyId,
      protocolId: params.protocolId,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Generování PDF se nezdařilo.");
  }
  return res.blob();
}

export async function signHandoverProtocol(params: {
  user: User;
  companyId: string;
  protocolId: string;
  role: "customer" | "contractor";
  signatureDataUrl: string;
}): Promise<void> {
  const token = await params.user.getIdToken();
  const res = await fetch("/api/company/handover-protocols/sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      companyId: params.companyId,
      protocolId: params.protocolId,
      role: params.role,
      signatureDataUrl: params.signatureDataUrl,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Uložení podpisu se nezdařilo.");
  }
}
