import type { User } from "firebase/auth";

function slugDownloadBase(title: string): string {
  return (
    title
      .trim()
      .replace(/[<>:"/\\|?*]+/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 72) || "zapis-schuzky"
  );
}

/** Stažení PDF zápisu přes firemní API (vyžaduje přihlášeného uživatele portálu). */
export async function downloadMeetingRecordPdf(
  user: User,
  companyId: string,
  recordId: string,
  displayTitle: string
): Promise<void> {
  const token = await user.getIdToken();
  const res = await fetch("/api/company/meeting-records/pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ companyId, recordId }),
  });
  if (!res.ok) {
    let msg = "PDF se nepodařilo vygenerovat.";
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="([^"]+)"/i.exec(cd);
  const fromHeader = m?.[1]?.trim();
  const name = fromHeader && fromHeader.endsWith(".pdf") ? fromHeader : `${slugDownloadBase(displayTitle)}.pdf`;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
