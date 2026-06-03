/**
 * HTML pro PDF předávacího protokolu (A4 na výšku, bez finančních údajů).
 */

import { escapeHtml, withLineBreaks } from "@/lib/work-contract-print-html";
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
  .doc-header { display: flex; gap: 20px; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
  .doc-logo img { max-height: 56px; max-width: 200px; object-fit: contain; }
  .doc-company { flex: 1; text-align: right; font-size: 9.5pt; line-height: 1.45; color: var(--muted); white-space: pre-wrap; }
  @media print {
    @page { margin: 14mm 12mm 16mm; size: A4 portrait; }
    body { background: #fff !important; }
    .sheet { max-width: none; margin: 0; padding: 0; }
    .block { page-break-inside: avoid; }
  }
  h1 { font-size: 18pt; margin: 0 0 6px; text-align: center; }
  .sub { text-align: center; font-size: 10pt; color: var(--muted); margin: 0 0 20px; }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 10.5pt; }
  table.meta td { padding: 6px 8px; border: 1px solid var(--border); vertical-align: top; }
  table.meta td.k { width: 32%; font-weight: 600; color: var(--muted); background: #f8fafc; }
  table.meta td.v { min-height: 1.6em; }
  .meta-blank { display: block; min-height: 1.2em; border-bottom: 1px solid #cbd5e1; }
  .section-title { font-size: 10.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; margin: 14px 0 6px; }
  .body { white-space: pre-wrap; font-size: 10.5pt; }
  .body-blank { min-height: 2.8em; }
  .blank-line { display: block; min-height: 1.35em; border-bottom: 1px solid #e2e8f0; margin-bottom: 4px; }
  table.defects { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 6px; }
  table.defects th, table.defects td { border: 1px solid var(--border); padding: 5px 6px; text-align: left; }
  table.defects th { background: #f1f5f9; font-weight: 700; }
  .sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-top: 24px;
    align-items: stretch;
  }
  .sig-box {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    min-height: 118px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .sig-box h4 { margin: 0 0 8px; font-size: 10pt; font-weight: 700; flex-shrink: 0; }
  .sig-area {
    flex: 1;
    min-height: 72px;
    max-height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px dashed #e2e8f0;
    border-radius: 4px;
    background: #fafafa;
    padding: 4px;
  }
  .sig-area-manual { background: #fff; }
  .sig-img {
    display: block;
    max-width: 100%;
    max-height: 64px;
    width: auto;
    height: auto;
    object-fit: contain;
    object-position: center center;
  }
  .sig-missing { color: var(--muted); font-size: 9pt; margin: 0; text-align: center; }
  .sig-meta { font-size: 8.5pt; color: var(--muted); margin: 6px 0 0; flex-shrink: 0; }
  ul.attach { margin: 4px 0 0 18px; font-size: 10pt; }
`;

function blankLinesHtml(lineCount: number): string {
  return Array.from({ length: lineCount }, () => '<span class="blank-line"></span>').join("");
}

function bodyFieldHtml(value: string, blankLines = 3): string {
  const t = value.trim();
  if (!t) {
    return `<div class="body body-blank">${blankLinesHtml(blankLines)}</div>`;
  }
  return `<div class="body">${withLineBreaks(t)}</div>`;
}

function metaValueHtml(value: string): string {
  const t = value.trim();
  if (!t) return `<span class="meta-blank"></span>`;
  return escapeHtml(t);
}

function defectsTableHtml(rows: HandoverDefectRow[]): string {
  if (!rows.length) {
    return `<div class="body body-blank">${blankLinesHtml(2)}</div>`;
  }
  const trs = rows
    .map(
      (r) => `<tr>
        <td>${r.description.trim() ? escapeHtml(r.description) : '<span class="meta-blank"></span>'}</td>
        <td>${r.removalDeadline.trim() ? escapeHtml(r.removalDeadline) : '<span class="meta-blank"></span>'}</td>
        <td>${escapeHtml(HANDOVER_DEFECT_STATUS_LABELS[r.status] ?? r.status)}</td>
      </tr>`
    )
    .join("");
  return `<table class="defects"><thead><tr><th>Popis vady</th><th>Termín odstranění</th><th>Stav</th></tr></thead><tbody>${trs}</tbody></table>`;
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

function resolveContractorSignatureForPdf(
  contractorSignature: HandoverSignatureMeta | null | undefined,
  organizationSignatureUrl: string | null | undefined,
  organizationStampName: string | null | undefined
): HandoverSignatureMeta | null {
  if (contractorSignature?.signatureImageUrl && String(contractorSignature.signatureImageUrl).trim()) {
    return contractorSignature;
  }
  const orgUrl = String(organizationSignatureUrl ?? "").trim();
  if (!orgUrl) return contractorSignature ?? null;
  return {
    signatureImageUrl: orgUrl,
    signedByName: organizationStampName ?? contractorSignature?.signedByName ?? null,
    signedAt: contractorSignature?.signedAt,
  };
}

function signatureBlockHtml(
  title: string,
  sig: HandoverSignatureMeta | null | undefined,
  useElectronicSignatures: boolean
): string {
  let inner: string;
  if (!useElectronicSignatures) {
    inner = `<div class="sig-area sig-area-manual" aria-label="Místo pro ruční podpis"></div>`;
  } else {
    const url = sig?.signatureImageUrl && String(sig.signatureImageUrl).trim();
    inner = url
      ? `<div class="sig-area"><img class="sig-img" alt="${escapeHtml(title)}" src="${escapeHtml(String(url))}" /></div>`
      : `<div class="sig-area"><p class="sig-missing">Podpis zatím chybí</p></div>`;
  }

  const when = useElectronicSignatures && sig?.signedAt ? formatSigDate(sig.signedAt) : "";
  const meta = useElectronicSignatures
    ? [when ? `Datum: ${escapeHtml(when)}` : "", sig?.signedByName ? escapeHtml(String(sig.signedByName)) : ""]
        .filter(Boolean)
        .join(" · ")
    : "";

  return `<div class="sig-box block">
    <h4>${escapeHtml(title)}</h4>
    ${inner}
    ${meta ? `<p class="sig-meta">${meta}</p>` : ""}
  </div>`;
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
  logoUrl?: string | null;
  companyAddressText?: string | null;
}): string {
  const s = params.snapshot;
  const f = params.form;
  const useElectronic = f.useElectronicSignatures !== false;
  const showDefects = f.showDefects !== false;
  const num = params.protocolNumber.trim();
  const title = f.documentTitle.trim() || "Předávací protokol";

  const logoBlock =
    params.logoUrl && String(params.logoUrl).trim()
      ? `<div class="doc-logo"><img src="${escapeHtml(String(params.logoUrl).trim())}" alt="Logo"/></div>`
      : "";
  const companyBlock = params.companyAddressText?.trim()
    ? `<div class="doc-company">${withLineBreaks(params.companyAddressText.trim())}</div>`
    : `<div class="doc-company">${escapeHtml(s.contractorCompanyName)}</div>`;
  const headerHtml = `<div class="doc-header block">${logoBlock}${companyBlock}</div>`;

  const metaRows = [
    ["Číslo protokolu", num],
    ["Datum předání", f.handoverDateLabel],
    ["Číslo zakázky", s.jobNumber],
    ["Název zakázky", s.jobName],
    ["Číslo smlouvy o dílo", s.workContractNumber],
    ["Datum vytvoření protokolu", s.createdAtLabel],
    ["Zákazník", s.customerName],
    ["Telefon", s.customerPhone],
    ["E-mail", s.customerEmail],
    ["Adresa realizace", s.realizationAddress],
    ["Zhotovitel", s.contractorCompanyName],
  ]
    .map(
      ([k, v]) =>
        `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${metaValueHtml(String(v ?? ""))}</td></tr>`
    )
    .join("");

  const optionalBlocks: string[] = [];
  if (f.handedDocumentation.trim()) {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Předaná dokumentace</div>${bodyFieldHtml(f.handedDocumentation, 2)}</div>`
    );
  } else {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Předaná dokumentace</div>${bodyFieldHtml("", 2)}</div>`
    );
  }
  if (f.handedManuals.trim()) {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Předané návody</div>${bodyFieldHtml(f.handedManuals, 2)}</div>`
    );
  } else {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Předané návody</div>${bodyFieldHtml("", 2)}</div>`
    );
  }
  if (f.handedKeys.trim()) {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Předané klíče</div>${bodyFieldHtml(f.handedKeys, 2)}</div>`
    );
  } else {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Předané klíče</div>${bodyFieldHtml("", 2)}</div>`
    );
  }
  if (f.otherHandedItems.trim()) {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Další předané položky</div>${bodyFieldHtml(f.otherHandedItems, 2)}</div>`
    );
  } else {
    optionalBlocks.push(
      `<div class="block"><div class="section-title">Další předané položky</div>${bodyFieldHtml("", 2)}</div>`
    );
  }

  const attachList =
    (params.attachments ?? []).length > 0
      ? `<ul class="attach">${(params.attachments ?? [])
          .map((a) => `<li>${escapeHtml(a.fileName)}</li>`)
          .join("")}</ul>`
      : bodyFieldHtml("", 2);

  const defectsBlock = showDefects
    ? `<div class="block"><div class="section-title">Vady a nedodělky</div>${defectsTableHtml(f.defects)}</div>`
    : "";

  const acceptanceBlock = f.acceptanceText.trim()
    ? bodyFieldHtml(f.acceptanceText, 4)
    : bodyFieldHtml("", 4);

  const contractorSig = useElectronic
    ? resolveContractorSignatureForPdf(
        params.contractorSignature,
        params.organizationSignatureUrl,
        params.organizationStampName
      )
    : null;

  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/><style>${HANDOVER_PDF_CSS}</style></head><body>
<div class="sheet">
  ${headerHtml}
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">Dokument předání díla (bez finančních údajů)</p>
  <table class="meta">${metaRows}</table>

  <div class="block"><div class="section-title">Předané dílo</div>${bodyFieldHtml(f.deliveredWork, 2)}</div>
  <div class="block"><div class="section-title">Popis dokončených prací</div>${bodyFieldHtml(f.completedWorkDescription, 3)}</div>
  <div class="block"><div class="section-title">Poznámka k předání</div>${bodyFieldHtml(f.handoverNote, 2)}</div>
  <div class="block"><div class="section-title">Potvrzení převzetí</div>${acceptanceBlock}</div>

  ${defectsBlock}

  <div class="block"><div class="section-title">Přílohy</div>${attachList}</div>

  <div class="sig-grid block">
    ${signatureBlockHtml("Podpis zhotovitele", contractorSig, useElectronic)}
    ${signatureBlockHtml("Podpis objednatele", params.customerSignature, useElectronic)}
  </div>
</div></body></html>`;
}
