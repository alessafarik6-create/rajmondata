/**
 * Společný tiskový / PDF layout dokladů ve formátu A4 (HTML + @page print).
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** CSS pro obrazovku + tisk — jedna stránka A4, fixní rozměry. */
export const INVOICE_A4_SCREEN_AND_PRINT_CSS = `
@page { size: A4; margin: 12mm; }
@media print {
  html, body { background: #fff !important; }
  .a4-sheet { box-shadow: none !important; margin: 0 !important; }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #e5e5e5; }
.a4-wrap {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 16px;
}
.a4-sheet {
  width: 210mm;
  min-height: 297mm;
  background: #fff;
  color: #111;
  font-family: system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 10pt;
  line-height: 1.45;
  padding: 14mm 16mm;
  box-shadow: 0 2px 12px rgba(0,0,0,0.12);
}
.doc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 14px; border-bottom: 2px solid #111; padding-bottom: 12px; }
.doc-header > div:first-child { min-width: 0; }
.doc-logo { flex-shrink: 0; margin-bottom: 8px; max-width: 100%; }
.doc-logo img {
  max-height: 100px;
  max-width: 340px;
  width: auto;
  height: auto;
  object-fit: contain;
  object-position: left top;
  display: block;
}
.bank-box { border: 1px solid #ccc; padding: 10px; margin: 12px 0; font-size: 9.5pt; background: #fafafa; }
.bank-box h3 { margin: 0 0 6px; font-size: 10pt; font-weight: 600; }
.doc-title { font-size: 16pt; font-weight: 700; margin: 0 0 4px; }
.doc-meta { font-size: 9.5pt; color: #333; }
.doc-meta p { margin: 2px 0; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 12px 0; }
.box { border: 1px solid #ccc; padding: 10px; }
.box h3 { margin: 0 0 6px; font-size: 10pt; }
.box div { white-space: pre-wrap; font-size: 9.5pt; }
table.items { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9pt; }
table.items th, table.items td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
table.items th { background: #f6f6f6; font-weight: 600; }
table.items td.num, table.items th.num { text-align: right; white-space: nowrap; }
table.totals { width: 100%; margin-top: 10px; border-collapse: collapse; font-size: 10pt; }
table.totals td { padding: 6px 8px; border-bottom: 1px solid #eee; }
table.totals td:first-child { width: 55%; color: #333; }
table.totals td:last-child { text-align: right; font-weight: 600; }
table.totals tr.grand td { font-size: 12pt; border-top: 2px solid #111; border-bottom: none; padding-top: 10px; }
.note { font-size: 9pt; color: #333; margin-top: 14px; }
.payment-qr-grid { display:grid; grid-template-columns: 1fr 120px; gap:10px; align-items:center; margin-top: 8px; }
.payment-qr-grid img { width:120px; height:120px; border:1px solid #ddd; background:#fff; }
.payment-warn { margin-top:8px; font-size:9pt; color:#8a3b00; background:#fff3e8; border:1px solid #f2c39b; padding:6px 8px; }
`;

export type InvoiceLineRow = {
  description: string;
  quantity: number;
  unit: string;
  unitPriceNet: number;
  vatRate: number;
  lineNet: number;
  lineVat: number;
  lineGross: number;
};

function fmtKc(n: number): string {
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

function brJoinEscaped(text: string): string {
  return text
    .split("\n")
    .map((l) => escapeHtml(l))
    .join("<br/>");
}

function bankBoxHtml(bankAccountText: string | null | undefined): string {
  const t = (bankAccountText || "").trim();
  if (!t) return "";
  return `<div class="bank-box"><h3>Platební údaje</h3><div>${brJoinEscaped(t)}</div></div>`;
}

export function buildAdvanceInvoiceHtml(params: {
  logoUrl?: string | null;
  title: string;
  supplierName: string;
  supplierAddressText: string;
  customerName: string;
  customerAddressText: string;
  invoiceNumber: string;
  issueDate: string;
  /** Datum zdanitelného plnění — výchozí stejné jako vystavení */
  taxSupplyDate?: string | null;
  dueDate: string;
  jobName: string;
  contractNumber?: string | null;
  variableSymbol?: string | null;
  /** Formátovaný text účtu / IBAN pro patičku */
  bankAccountText?: string | null;
  paymentDueDate?: string | null;
  paymentQrUrl?: string | null;
  paymentQrWarning?: string | null;
  items: InvoiceLineRow[];
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  /** Pro jednoduchý zápis jedné sazby v patičce součtu */
  primaryVatRateLabel?: string;
  note?: string;
}): string {
  const supplierLines = brJoinEscaped(params.supplierAddressText || params.supplierName);
  const customerLines = brJoinEscaped(params.customerAddressText || params.customerName);
  const logoBlock =
    params.logoUrl && String(params.logoUrl).trim()
      ? `<div class="doc-logo"><img src="${escapeHtml(String(params.logoUrl).trim())}" alt="Logo"/></div>`
      : "";
  const taxSupply =
    (params.taxSupplyDate && String(params.taxSupplyDate).trim()) ||
    params.issueDate;

  const rowsHtml = params.items
    .map(
      (r) => `<tr>
<td>${escapeHtml(r.description)}</td>
<td class="num">${escapeHtml(String(r.quantity).replace(".", ","))}</td>
<td>${escapeHtml(r.unit || "ks")}</td>
<td class="num">${fmtKc(r.unitPriceNet)}</td>
<td class="num">${escapeHtml(String(r.vatRate))} %</td>
<td class="num">${fmtKc(r.lineNet)}</td>
<td class="num">${fmtKc(r.lineVat)}</td>
<td class="num">${fmtKc(r.lineGross)}</td>
</tr>`
    )
    .join("");

  const vs = params.variableSymbol ? String(params.variableSymbol).trim() : "";
  const bankHtml = bankBoxHtml(params.bankAccountText);
  const paymentMeta = `<div class="doc-meta">
    ${params.variableSymbol ? `<p><strong>VS:</strong> ${escapeHtml(String(params.variableSymbol))}</p>` : ""}
    ${params.paymentDueDate ? `<p><strong>Splatnost:</strong> ${escapeHtml(params.paymentDueDate)}</p>` : ""}
    <p><strong>Částka:</strong> ${fmtKc(params.amountGross)}</p>
  </div>`;
  const qrHtml = params.paymentQrUrl
    ? `<div class="payment-qr-grid"><div>${paymentMeta}</div><img src="${escapeHtml(
        String(params.paymentQrUrl)
      )}" alt="QR platba"/></div>`
    : "";
  const qrWarn = params.paymentQrWarning
    ? `<div class="payment-warn">${escapeHtml(params.paymentQrWarning)}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8"/>
<style>${INVOICE_A4_SCREEN_AND_PRINT_CSS}</style>
<title>${escapeHtml(params.title)}</title>
</head>
<body>
<div class="a4-wrap">
  <div class="a4-sheet">
    <div class="doc-header">
      <div>
        ${logoBlock}
        <div class="doc-title">${escapeHtml(params.title)}</div>
        <div class="doc-meta">
          <p><strong>Číslo:</strong> ${escapeHtml(params.invoiceNumber)}</p>
          <p><strong>Datum vystavení:</strong> ${escapeHtml(params.issueDate)}</p>
          <p><strong>Datum zdanitelného plnění:</strong> ${escapeHtml(taxSupply)}</p>
          <p><strong>Splatnost:</strong> ${escapeHtml(params.dueDate)}</p>
          <p><strong>Zakázka:</strong> ${escapeHtml(params.jobName)}</p>
          ${params.contractNumber ? `<p><strong>Smlouva č.:</strong> ${escapeHtml(String(params.contractNumber))}</p>` : ""}
          ${vs ? `<p><strong>Variabilní symbol:</strong> ${escapeHtml(vs)}</p>` : ""}
        </div>
      </div>
      <div class="doc-meta" style="text-align:right">
        <strong>${escapeHtml(params.supplierName)}</strong>
      </div>
    </div>
    <div class="grid2">
      <div class="box"><h3>Dodavatel</h3><div>${supplierLines}</div></div>
      <div class="box"><h3>Odběratel</h3><div>${customerLines}</div></div>
    </div>
    ${bankHtml}
    ${qrHtml}
    ${qrWarn}
    <table class="items">
      <thead>
        <tr>
          <th>Položka</th>
          <th class="num">Množství</th>
          <th>j.</th>
          <th class="num">Cena bez DPH</th>
          <th class="num">DPH %</th>
          <th class="num">Základ</th>
          <th class="num">DPH</th>
          <th class="num">Celkem s DPH</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <table class="totals">
      <tr><td>Základ daně celkem</td><td>${fmtKc(params.amountNet)}</td></tr>
      <tr><td>DPH${params.primaryVatRateLabel ? ` (${escapeHtml(params.primaryVatRateLabel)})` : ""}</td><td>${fmtKc(params.vatAmount)}</td></tr>
      <tr class="grand"><td><strong>Celkem k úhradě</strong></td><td>${fmtKc(params.amountGross)}</td></tr>
    </table>
    <p class="note">${escapeHtml(params.note ?? "Doklad slouží jako zálohová faktura dle smlouvy o dílo.")}</p>
  </div>
</div>
</body>
</html>`;
}

export function buildTaxReceiptHtml(params: {
  logoUrl?: string | null;
  supplierName: string;
  supplierAddressText: string;
  customerName: string;
  customerAddressText: string;
  documentNumber: string;
  /** Datum vystavení daňového dokladu */
  issueDate: string;
  /** Zdanitelné plnění — u zálohy typicky datum přijetí platby */
  taxSupplyDate?: string | null;
  paymentDate: string;
  relatedInvoiceNumber: string;
  jobName: string;
  amountNet: number;
  vatRate: number;
  vatAmount: number;
  amountGross: number;
  variableSymbol?: string;
  bankAccountText?: string | null;
  paymentQrUrl?: string | null;
  paymentQrWarning?: string | null;
  note?: string;
}): string {
  const supplierLines = brJoinEscaped(params.supplierAddressText || params.supplierName);
  const customerLines = brJoinEscaped(params.customerAddressText || params.customerName);
  const logoBlock =
    params.logoUrl && String(params.logoUrl).trim()
      ? `<div class="doc-logo"><img src="${escapeHtml(String(params.logoUrl).trim())}" alt="Logo"/></div>`
      : "";
  const taxSupply =
    (params.taxSupplyDate && String(params.taxSupplyDate).trim()) || params.paymentDate;
  const bankHtml = bankBoxHtml(params.bankAccountText);
  const paymentMeta = `<div class="doc-meta">
    ${params.variableSymbol ? `<p><strong>VS:</strong> ${escapeHtml(String(params.variableSymbol))}</p>` : ""}
    <p><strong>Částka:</strong> ${fmtKc(params.amountGross)}</p>
    <p><strong>Datum:</strong> ${escapeHtml(params.paymentDate)}</p>
  </div>`;
  const qrHtml = params.paymentQrUrl
    ? `<div class="payment-qr-grid"><div>${paymentMeta}</div><img src="${escapeHtml(
        String(params.paymentQrUrl)
      )}" alt="QR platba"/></div>`
    : "";
  const qrWarn = params.paymentQrWarning
    ? `<div class="payment-warn">${escapeHtml(params.paymentQrWarning)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8"/>
<style>${INVOICE_A4_SCREEN_AND_PRINT_CSS}</style>
<title>Daňový doklad k přijaté platbě</title>
</head>
<body>
<div class="a4-wrap">
  <div class="a4-sheet">
    <div class="doc-header">
      <div>
        ${logoBlock}
        <div class="doc-title">Daňový doklad k přijaté platbě</div>
        <div class="doc-meta">
          <p><strong>Číslo dokladu:</strong> ${escapeHtml(params.documentNumber)}</p>
          <p><strong>Datum vystavení:</strong> ${escapeHtml(params.issueDate)}</p>
          <p><strong>Datum zdanitelného plnění:</strong> ${escapeHtml(taxSupply)}</p>
          <p><strong>Datum přijetí platby:</strong> ${escapeHtml(params.paymentDate)}</p>
          <p><strong>Vazba na zálohovou fakturu:</strong> ${escapeHtml(params.relatedInvoiceNumber)}</p>
          <p><strong>Zakázka:</strong> ${escapeHtml(params.jobName)}</p>
          ${params.variableSymbol ? `<p><strong>Variabilní symbol:</strong> ${escapeHtml(params.variableSymbol)}</p>` : ""}
        </div>
      </div>
      <div class="doc-meta" style="text-align:right"><strong>${escapeHtml(params.supplierName)}</strong></div>
    </div>
    <div class="grid2">
      <div class="box"><h3>Dodavatel</h3><div>${supplierLines}</div></div>
      <div class="box"><h3>Odběratel</h3><div>${customerLines}</div></div>
    </div>
    ${bankHtml}
    ${qrHtml}
    ${qrWarn}
    <table class="totals">
      <tr><td>Základ daně</td><td>${fmtKc(params.amountNet)}</td></tr>
      <tr><td>DPH (${params.vatRate} %)</td><td>${fmtKc(params.vatAmount)}</td></tr>
      <tr class="grand"><td><strong>Uhrazeno celkem</strong></td><td>${fmtKc(params.amountGross)}</td></tr>
    </table>
    <p class="note">${escapeHtml(params.note ?? "Doklad potvrzuje přijetí platby na účet a plní účetní funkci daňového dokladu k přijaté platbě.")}</p>
  </div>
</div>
</body>
</html>`;
}

export type SettlementAdvanceRow = {
  label: string;
  amountGross: number;
};

/**
 * Vyúčtovací / konečná faktura po dokončení zakázky — A4, souhrn záloh + doplatek.
 */
export function buildFinalSettlementInvoiceHtml(params: {
  logoUrl?: string | null;
  supplierName: string;
  supplierAddressText: string;
  customerName: string;
  customerAddressText: string;
  invoiceNumber: string;
  issueDate: string;
  taxSupplyDate?: string | null;
  dueDate: string;
  jobName: string;
  contractNumber?: string | null;
  variableSymbol?: string | null;
  bankAccountText?: string | null;
  paymentDueDate?: string | null;
  paymentQrUrl?: string | null;
  paymentQrWarning?: string | null;
  totalContractGross: number;
  advanceRows: SettlementAdvanceRow[];
  totalAdvancePaid: number;
  items: InvoiceLineRow[];
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  primaryVatRateLabel?: string;
  note?: string;
}): string {
  const supplierLines = brJoinEscaped(params.supplierAddressText || params.supplierName);
  const customerLines = brJoinEscaped(params.customerAddressText || params.customerName);
  const logoBlock =
    params.logoUrl && String(params.logoUrl).trim()
      ? `<div class="doc-logo"><img src="${escapeHtml(String(params.logoUrl).trim())}" alt="Logo"/></div>`
      : "";
  const vs = params.variableSymbol ? String(params.variableSymbol).trim() : "";
  const taxSupply =
    (params.taxSupplyDate && String(params.taxSupplyDate).trim()) || params.issueDate;
  const bankHtml = bankBoxHtml(params.bankAccountText);
  const paymentMeta = `<div class="doc-meta">
    ${params.variableSymbol ? `<p><strong>VS:</strong> ${escapeHtml(String(params.variableSymbol))}</p>` : ""}
    ${params.paymentDueDate ? `<p><strong>Splatnost:</strong> ${escapeHtml(params.paymentDueDate)}</p>` : ""}
    <p><strong>Částka:</strong> ${fmtKc(params.amountGross)}</p>
  </div>`;
  const qrHtml = params.paymentQrUrl
    ? `<div class="payment-qr-grid"><div>${paymentMeta}</div><img src="${escapeHtml(
        String(params.paymentQrUrl)
      )}" alt="QR platba"/></div>`
    : "";
  const qrWarn = params.paymentQrWarning
    ? `<div class="payment-warn">${escapeHtml(params.paymentQrWarning)}</div>`
    : "";

  const advanceTable =
    params.advanceRows.length > 0
      ? `<table class="items">
  <thead><tr><th>Popis (záloha / odečet)</th><th class="num">Částka s DPH</th></tr></thead>
  <tbody>${params.advanceRows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.label)}</td><td class="num">${fmtKc(r.amountGross)}</td></tr>`
    )
    .join("")}
  <tr><td><strong>Odečteno celkem</strong></td><td class="num"><strong>${fmtKc(params.totalAdvancePaid)}</strong></td></tr>
  </tbody></table>`
      : `<p class="note">Žádné evidované zálohy ze zálohových faktur — použit odhad dle smlouvy nebo 0 Kč.</p>`;

  const rowsHtml = params.items
    .map(
      (r) => `<tr>
<td>${escapeHtml(r.description)}</td>
<td class="num">${escapeHtml(String(r.quantity).replace(".", ","))}</td>
<td>${escapeHtml(r.unit || "ks")}</td>
<td class="num">${fmtKc(r.unitPriceNet)}</td>
<td class="num">${escapeHtml(String(r.vatRate))} %</td>
<td class="num">${fmtKc(r.lineNet)}</td>
<td class="num">${fmtKc(r.lineVat)}</td>
<td class="num">${fmtKc(r.lineGross)}</td>
</tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8"/>
<style>${INVOICE_A4_SCREEN_AND_PRINT_CSS}</style>
<title>Vyúčtovací faktura</title>
</head>
<body>
<div class="a4-wrap">
  <div class="a4-sheet">
    <div class="doc-header">
      <div>
        ${logoBlock}
        <div class="doc-title">Vyúčtovací faktura (konečné vyúčtování)</div>
        <div class="doc-meta">
          <p><strong>Číslo:</strong> ${escapeHtml(params.invoiceNumber)}</p>
          <p><strong>Datum vystavení:</strong> ${escapeHtml(params.issueDate)}</p>
          <p><strong>Datum zdanitelného plnění:</strong> ${escapeHtml(taxSupply)}</p>
          <p><strong>Splatnost:</strong> ${escapeHtml(params.dueDate)}</p>
          <p><strong>Zakázka:</strong> ${escapeHtml(params.jobName)}</p>
          ${params.contractNumber ? `<p><strong>Smlouva č.:</strong> ${escapeHtml(String(params.contractNumber))}</p>` : ""}
          ${vs ? `<p><strong>Variabilní symbol:</strong> ${escapeHtml(vs)}</p>` : ""}
        </div>
      </div>
      <div class="doc-meta" style="text-align:right"><strong>${escapeHtml(params.supplierName)}</strong></div>
    </div>
    <div class="grid2">
      <div class="box"><h3>Dodavatel</h3><div>${supplierLines}</div></div>
      <div class="box"><h3>Odběratel</h3><div>${customerLines}</div></div>
    </div>
    ${bankHtml}
    ${qrHtml}
    ${qrWarn}
    <table class="totals">
      <tr><td>Celková cena zakázky (s DPH)</td><td>${fmtKc(params.totalContractGross)}</td></tr>
    </table>
    <h3 style="font-size:10pt;margin:12px 0 6px">Odečtené zálohy</h3>
    ${advanceTable}
    <h3 style="font-size:10pt;margin:12px 0 6px">Položky — doplatek</h3>
    <table class="items">
      <thead>
        <tr>
          <th>Položka</th>
          <th class="num">Množství</th>
          <th>j.</th>
          <th class="num">Cena bez DPH</th>
          <th class="num">DPH %</th>
          <th class="num">Základ</th>
          <th class="num">DPH</th>
          <th class="num">Celkem s DPH</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <table class="totals">
      <tr><td>Základ daně celkem</td><td>${fmtKc(params.amountNet)}</td></tr>
      <tr><td>DPH${params.primaryVatRateLabel ? ` (${escapeHtml(params.primaryVatRateLabel)})` : ""}</td><td>${fmtKc(params.vatAmount)}</td></tr>
      <tr class="grand"><td><strong>Celkem k úhradě (doplatek)</strong></td><td>${fmtKc(params.amountGross)}</td></tr>
    </table>
    <p class="note">${escapeHtml(params.note ?? "Doklad dokončuje vyúčtování zakázky po odečtení uhrazených záloh.")}</p>
  </div>
</div>
</body>
</html>`;
}

/** Jednořádková záloha ze smlouvy — jedna položka. */
export function singleLineFromGross(params: {
  description: string;
  amountNet: number;
  vatRate: number;
  vatAmount: number;
  amountGross: number;
}): InvoiceLineRow {
  return {
    description: params.description,
    quantity: 1,
    unit: "ks",
    unitPriceNet: params.amountNet,
    vatRate: params.vatRate,
    lineNet: params.amountNet,
    lineVat: params.vatAmount,
    lineGross: params.amountGross,
  };
}

/**
 * Náhled v iframe musí být čisté HTML/CSS — bez JS.
 * Odstraní &lt;script&gt;, vnořené rámy a inline handlery, aby v prohlížeči nevznikaly
 * chyby typu „Blocked script execution in about:srcdoc“ u sandboxovaného iframe.
 */
export function sanitizeInvoicePreviewHtml(html: string): string {
  if (!html) return "";
  let out = html;
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script\b[^>]*\/?>/gi, "");
  out = out.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
  out = out.replace(/<iframe\b[^>]*\/?>/gi, "");
  out = out.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "");
  out = out.replace(/<embed\b[^>]*\/?>/gi, "");
  out = out.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/href\s*=\s*["']?\s*javascript:[^"'>\s]*/gi, 'href="#"');
  return out;
}
