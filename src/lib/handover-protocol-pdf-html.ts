/**
 * HTML pro PDF předávacího protokolu (A4 na výšku, bez finančních údajů).
 */

import {
  buildOrganizationElectronicStampBlock,
  escapeHtml,
  withLineBreaks,
} from "@/lib/work-contract-print-html";
import {
  HANDOVER_DEFECT_STATUS_LABELS,
  type HandoverDefectRow,
  type HandoverProtocolForm,
  type HandoverSignatureMeta,
} from "@/lib/handover-protocol-types";

const HANDOVER_PDF_CSS = `
  :root { --ink: #0a0a0a; --muted: #404040; --border: #bdbdbd; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; padding: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 11pt; line-height: 1.5; color: var(--ink); background: #fff;
  }
  .sheet { max-width: 800px; margin: 0 auto; padding: 28px 32px 36px; }
  @media print {
    @page { margin: 14mm 12mm 16mm; size: A4 portrait; }
    body { background: #fff !important; }
    .sheet { max-width: none; margin: 0; padding: 0; }
    .block { page-break-inside: avoid; }
  }
  h1 { font-size: 18pt; margin: 0 0 6px; text-align: center; }
  .sub { text-align: center; font-size: 10pt; color: var(--muted); margin: 0 0 20px; }
  .org-line { font-size: 10pt; font-weight: 700; text-align: center; margin-bottom: 16px; color: #1e293b; }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 10.5pt; }
  table.meta td { padding: 6px 8px; border: 1px solid var(--border); vertical-align: top; }
  table.meta td.k { width: 32%; font-weight: 600; color: var(--muted); background: #f8fafc; }
  .section-title { font-size: 10.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; margin: 14px 0 6px; }
  .body { white-space: pre-wrap; font-size: 10.5pt; }
  table.defects { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 6px; }
  table.defects th, table.defects td { border: 1px solid var(--border); padding: 5px 6px; text-align: left; }
  table.defects th { background: #f1f5f9; font-weight: 700; }
  .sig-grid { display: flex; gap: 24px; margin-top: 20px; flex-wrap: wrap; }
  .sig-box { flex: 1 1 240px; min-width: 200px; border: 1px solid var(--border); border-radius: 8px; padding: 10px; min-height: 100px; }
  .sig-box h4 { margin: 0 0 8px; font-size: 10pt; }
  .sig-img { max-width: 100%; max-height: 72px; object-fit: contain; }
  ul.attach { margin: 4px 0 0 18px; font-size: 10pt; }
`;

function defectsTableHtml(rows: HandoverDefectRow[]): string {
  if (!rows.length) {
    return `<p class="body" style="color:var(--muted)">Bez záznamu vad a nedodělků.</p>`;
  }
  const trs = rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.description || "—")}</td>
        <td>${escapeHtml(r.removalDeadline || "—")}</td>
        <td>${escapeHtml(HANDOVER_DEFECT_STATUS_LABELS[r.status] ?? r.status)}</td>
      </tr>`
    )
    .join("");
  return `<table class="defects"><thead><tr><th>Popis vady</th><th>Termín odstranění</th><th>Stav</th></tr></thead><tbody>${trs}</tbody></table>`;
}

function signatureBlockHtml(
  title: string,
  sig: HandoverSignatureMeta | null | undefined
): string {
  const img =
    sig?.signatureImageUrl && String(sig.signatureImageUrl).trim()
      ? `<img class="sig-img" alt="${escapeHtml(title)}" src="${escapeHtml(String(sig.signatureImageUrl))}" />`
      : `<p style="color:var(--muted);font-size:9pt;margin:8px 0 0">Podpis zatím chybí</p>`;
  const when = sig?.signedAt
    ? formatSigDate(sig.signedAt)
    : "";
  const meta = [
    when ? `Datum: ${escapeHtml(when)}` : "",
    sig?.signedByName ? escapeHtml(String(sig.signedByName)) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<div class="sig-box block"><h4>${escapeHtml(title)}</h4>${img}${meta ? `<p style="font-size:9pt;margin:6px 0 0">${meta}</p>` : ""}</div>`;
}

function formatSigDate(raw: unknown): string {
  try {
    if (raw && typeof raw === "object" && "toDate" in (raw as object)) {
      return (raw as { toDate: () => Date }).toDate().toLocaleString("cs-CZ");
    }
    if (raw instanceof Date) return raw.toLocaleString("cs-CZ");
    if (typeof raw === "number" && raw > 0) return new Date(raw).toLocaleString("cs-CZ");
  } catch {
    /* ignore */
  }
  return "";
}

export function buildHandoverProtocolPdfHtml(params: {
  snapshot: {
    jobNumber: string;
    jobName: string;
    workContractNumber: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    realizationAddress: string;
    createdAtLabel: string;
    contractorCompanyName: string;
  };
  form: HandoverProtocolForm;
  protocolNumber: string;
  contractorSignature?: HandoverSignatureMeta | null;
  customerSignature?: HandoverSignatureMeta | null;
  organizationSignatureUrl?: string | null;
  organizationStampName?: string | null;
  attachments?: { fileName: string }[];
}): string {
  const s = params.snapshot;
  const f = params.form;
  const num = params.protocolNumber.trim() || "—";
  const title = f.documentTitle.trim() || "Předávací protokol";

  const metaRows = [
    ["Číslo protokolu", num],
    ["Datum předání", f.handoverDateLabel || "—"],
    ["Číslo zakázky", s.jobNumber || "—"],
    ["Název zakázky", s.jobName || "—"],
    ["Číslo smlouvy o dílo", s.workContractNumber || "—"],
    ["Datum vytvoření protokolu", s.createdAtLabel || "—"],
    ["Zákazník", s.customerName || "—"],
    ["Telefon", s.customerPhone || "—"],
    ["E-mail", s.customerEmail || "—"],
    ["Adresa realizace", s.realizationAddress || "—"],
    ["Zhotovitel", s.contractorCompanyName || "—"],
  ]
    .map(
      ([k, v]) =>
        `<tr><td class="k">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`
    )
    .join("");

  const optionalBlocks: string[] = [];
  if (f.handedDocumentation.trim()) {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Předaná dokumentace</div><div class="body">${withLineBreaks(f.handedDocumentation)}</div></div>`
    );
  }
  if (f.handedManuals.trim()) {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Předané návody</div><div class="body">${withLineBreaks(f.handedManuals)}</div></div>`
    );
  }
  if (f.handedKeys.trim()) {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Předané klíče</div><div class="body">${withLineBreaks(f.handedKeys)}</div></div>`
    );
  }
  if (f.otherHandedItems.trim()) {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Další předané položky</div><div class="body">${withLineBreaks(f.otherHandedItems)}</div></div>`
    );
  }

  const attachList =
    (params.attachments ?? []).length > 0
      ? `<ul class="attach">${(params.attachments ?? [])
          .map((a) => `<li>${escapeHtml(a.fileName)}</li>`)
          .join("")}</ul>`
      : `<p class="body" style="color:var(--muted)">—</p>`;

  const orgStamp =
    params.organizationSignatureUrl?.trim()
      ? buildOrganizationElectronicStampBlock({
          organizationSignatureUrl: params.organizationSignatureUrl,
          organizationStampName: params.organizationStampName ?? s.contractorCompanyName,
          electronicSignatureDateLabel: f.handoverDateLabel || s.createdAtLabel,
          electronicSignatureSignerName: params.organizationStampName ?? null,
        })
      : "";

  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/><style>${HANDOVER_PDF_CSS}</style></head><body>
<div class="sheet">
  <div class="org-line">${escapeHtml(s.contractorCompanyName)}</div>
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">Dokument předání díla (bez finančních údajů)</p>
  <table class="meta">${metaRows}</table>

  <div class="block"><div class="section-title">Předané dílo</div><div class="body">${withLineBreaks(f.deliveredWork || "—")}</div></div>
  <div class="block"><div class="section-title">Popis dokončených prací</div><div class="body">${withLineBreaks(f.completedWorkDescription || "—")}</div></div>
  <div class="block"><div class="section-title">Poznámka k předání</div><div class="body">${withLineBreaks(f.handoverNote || "—")}</div></div>
  <div class="block"><div class="section-title">Potvrzení převzetí</div><div class="body">${withLineBreaks(f.acceptanceText)}</div></div>

  <div class="block"><div class="section-title">Vady a nedodělky</div>${defectsTableHtml(f.defects)}</div>
  ${optionalBlocks.join("")}

  <div class="block"><div class="section-title">Přílohy</div>${attachList}</div>

  ${orgStamp}

  <div class="sig-grid block">
    ${signatureBlockHtml("Podpis zhotovitele", params.contractorSignature)}
    ${signatureBlockHtml("Podpis objednatele", params.customerSignature)}
  </div>
</div></body></html>`;
}
