import type { User } from "firebase/auth";

/** Generuje PDF z HTML reportu nákladů (stejný endpoint jako protokol). */
export async function downloadJobExpensesReportPdf(params: {
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
