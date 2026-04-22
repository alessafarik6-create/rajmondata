/**
 * HTML pro PDF zápisů ze schůzek (server: Puppeteer stejně jako u smluv / faktur).
 */

import {
  buildOrganizationElectronicStampBlock,
  escapeHtml,
  withLineBreaks,
} from "@/lib/work-contract-print-html";
import { resolveMeetingTitle } from "@/lib/meeting-records-types";

function formatMeetingAtCs(raw: unknown): string {
  if (raw == null) return "—";
  if (
    typeof raw === "object" &&
    raw !== null &&
    "toDate" in raw &&
    typeof (raw as { toDate: () => Date }).toDate === "function"
  ) {
    try {
      return (raw as { toDate: () => Date }).toDate().toLocaleString("cs-CZ", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return "—";
    }
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" });
  }
  return "—";
}

const MEETING_RECORD_PDF_CSS = `
  :root { --ink: #0a0a0a; --muted: #404040; --border: #bdbdbd; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    padding: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: var(--ink);
    background: #fff;
  }
  .sheet { max-width: 800px; margin: 0 auto; padding: 28px 32px 36px; }
  @media print {
    @page { margin: 14mm 12mm 16mm; size: A4; }
    body { background: #fff !important; }
    .sheet { max-width: none; margin: 0; padding: 0; }
    .block { page-break-inside: avoid; }
  }
  h1 { font-size: 18pt; margin: 0 0 6px; text-align: center; }
  .sub { text-align: center; font-size: 10pt; color: var(--muted); margin: 0 0 22px; }
  .org-line { font-size: 10pt; font-weight: 700; text-align: center; margin-bottom: 18px; color: #1e293b; }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 10.5pt; }
  table.meta td { padding: 6px 8px; border: 1px solid var(--border); vertical-align: top; }
  table.meta td.k { width: 28%; font-weight: 600; color: var(--muted); background: #f8fafc; }
  .section-title { font-size: 10.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; margin: 16px 0 6px; }
  .body { white-space: pre-wrap; font-size: 10.5pt; }
  .org-signature { max-width: 100%; max-height: 48px; object-fit: contain; }
  .e-signature-stamp { display: inline-block; max-width: 100%; margin: 12px 0 4px; }
  .e-stamp-border {
    border: 2px double #7f1d1d;
    border-radius: 10px;
    padding: 8px 10px 9px;
    background: linear-gradient(180deg, #fff7f7 0%, #ffffff 55%, #fffbfb 100%);
  }
  .e-stamp-header { font-size: 9.5pt; font-weight: 900; letter-spacing: 0.02em; color: #7f1d1d; text-transform: uppercase; }
  .e-stamp-status { font-size: 8.2pt; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #991b1b; margin: 4px 0 6px; }
  .e-stamp-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
  .e-stamp-sig { flex: 0 0 auto; min-width: 120px; border: 1px dashed rgba(127, 29, 29, 0.35); border-radius: 6px; padding: 4px 6px; }
  .e-stamp-meta { flex: 1 1 140px; min-width: 120px; font-size: 8.6pt; color: var(--muted); }
  .e-stamp-date { font-weight: 700; color: var(--ink); }
  .e-stamp-signer { margin-top: 2px; font-size: 8.4pt; color: var(--ink); }
`;

export function buildMeetingRecordPdfHtml(params: {
  record: Record<string, unknown>;
  companyName: string;
  organizationSignatureUrl?: string | null;
  organizationStampName?: string | null;
  electronicSignatureDateLabel?: string | null;
  electronicSignatureSignerName?: string | null;
  jobDisplayName?: string | null;
}): string {
  const r = params.record;
  const title =
    resolveMeetingTitle({
      title: typeof r.title === "string" ? r.title : "",
      meetingTitle: typeof r.meetingTitle === "string" ? r.meetingTitle : null,
    }) || "Zápis ze schůzky";
  const when = formatMeetingAtCs(r.meetingAt);
  const place = typeof r.place === "string" && r.place.trim() ? r.place.trim() : "";
  const participants =
    typeof r.participants === "string" && r.participants.trim() ? r.participants.trim() : "";
  const jobName =
    (typeof params.jobDisplayName === "string" && params.jobDisplayName.trim()
      ? params.jobDisplayName.trim()
      : null) ||
    (typeof r.jobName === "string" && r.jobName.trim() ? r.jobName.trim() : "") ||
    (typeof r.jobId === "string" && r.jobId.trim() ? r.jobId.trim() : "");
  const customer =
    typeof r.customerName === "string" && r.customerName.trim() ? r.customerName.trim() : "—";
  const notes =
    typeof r.meetingNotes === "string" && r.meetingNotes.trim() ? r.meetingNotes.trim() : "—";
  const next =
    typeof r.nextSteps === "string" && r.nextSteps.trim() ? r.nextSteps.trim() : "";

  const stamp = buildOrganizationElectronicStampBlock({
    organizationSignatureUrl: params.organizationSignatureUrl,
    organizationStampName: params.organizationStampName ?? params.companyName,
    electronicSignatureDateLabel: params.electronicSignatureDateLabel ?? when,
    electronicSignatureSignerName: params.electronicSignatureSignerName,
  });

  const rows: { k: string; v: string }[] = [
    { k: "Datum a čas", v: when },
    { k: "Místo", v: place || "—" },
    { k: "Účastníci", v: participants || "—" },
    { k: "Zakázka", v: jobName || "—" },
    { k: "Zákazník", v: customer },
  ];

  const metaHtml = rows
    .map(
      (row) =>
        `<tr><td class="k">${escapeHtml(row.k)}</td><td>${row.v === "—" ? "—" : withLineBreaks(row.v)}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <style>${MEETING_RECORD_PDF_CSS}</style>
</head>
<body>
  <div class="sheet">
    <div class="org-line">${escapeHtml(params.companyName)}</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">Zápis ze schůzky</p>
    <table class="meta">${metaHtml}</table>
    <div class="block">
      <div class="section-title">Poznámky</div>
      <div class="body">${notes === "—" ? "—" : withLineBreaks(notes)}</div>
    </div>
    ${
      next
        ? `<div class="block">
      <div class="section-title">Úkoly / další kroky</div>
      <div class="body">${withLineBreaks(next)}</div>
    </div>`
        : ""
    }
    ${stamp ? `<div class="block">${stamp}</div>` : ""}
  </div>
</body>
</html>`;
}
