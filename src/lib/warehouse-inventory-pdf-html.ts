import { escapeHtml } from "@/lib/work-contract-print-html";
import { formatInventoryMoneyCzk } from "@/lib/inventory-helpers";
import type { WarehouseInventoryDoc, WarehousePdfExportKind } from "@/lib/warehouse-inventory-types";
import { computeLineDiff } from "@/lib/warehouse-inventory-diff";

export type WarehousePdfItemRow = {
  name: string;
  sku?: string | null;
  unit: string;
  quantity: number;
  unitPrice?: number | null;
  categoryName?: string | null;
  systemDisplay?: string | null;
};

export type WarehousePdfMeta = {
  companyName: string;
  logoUrl?: string | null;
  warehouseName: string;
  createdAtLabel: string;
  title: string;
  subtitle?: string;
};

const BASE_CSS = `
  :root { --ink: #0f172a; --muted: #64748b; --border: #cbd5e1; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; padding: 0;
    font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 10pt; line-height: 1.4; color: var(--ink); background: #fff;
  }
  .page-footer {
    position: fixed; bottom: 0; left: 0; right: 0;
    text-align: center; font-size: 8pt; color: var(--muted);
    padding: 4mm 0;
  }
  .doc-header { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
  .doc-logo img { max-height: 52px; max-width: 180px; object-fit: contain; }
  .doc-meta { text-align: right; font-size: 9pt; color: var(--muted); line-height: 1.45; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .sub { font-size: 9.5pt; color: var(--muted); margin: 0 0 12px; }
  table.grid { width: 100%; border-collapse: collapse; font-size: 9pt; }
  table.grid th, table.grid td { border: 1px solid var(--border); padding: 6px 8px; vertical-align: top; }
  table.grid th { background: #f1f5f9; font-weight: 700; text-align: left; }
  table.grid td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .blank { display: block; min-height: 1.4em; border-bottom: 1px dashed #94a3b8; }
  .summary { margin-top: 10px; font-size: 9.5pt; }
  .sig-block { margin-top: 16px; font-size: 9pt; }
  .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; }
  .sig-box { border: 1px solid var(--border); padding: 8px 10px; min-height: 64px; }
  @media print {
    @page { margin: 12mm 10mm 18mm; size: A4 portrait; }
    @page landscape { size: A4 landscape; margin: 10mm 10mm 16mm; }
    .landscape { page: landscape; }
    body { counter-reset: page; }
    .page-footer::after { content: " · str. " counter(page); }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
  }
`;

function headerHtml(meta: WarehousePdfMeta): string {
  const logo =
    meta.logoUrl && String(meta.logoUrl).trim()
      ? `<div class="doc-logo"><img src="${escapeHtml(String(meta.logoUrl).trim())}" alt="Logo"/></div>`
      : "";
  return `<div class="doc-header">
    ${logo}
    <div class="doc-meta">
      <strong>${escapeHtml(meta.companyName)}</strong><br/>
      ${escapeHtml(meta.warehouseName)}<br/>
      Vytvořeno: ${escapeHtml(meta.createdAtLabel)}
    </div>
  </div>
  <h1>${escapeHtml(meta.title)}</h1>
  ${meta.subtitle ? `<p class="sub">${escapeHtml(meta.subtitle)}</p>` : ""}`;
}

function rowsStockList(items: WarehousePdfItemRow[], showPrices: boolean): string {
  const trs = items
    .map((r) => {
      const val =
        showPrices && r.unitPrice != null
          ? formatInventoryMoneyCzk(Number(r.quantity) * Number(r.unitPrice))
          : "—";
      return `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(String(r.sku ?? "—"))}</td>
        <td>${escapeHtml(String(r.categoryName ?? "—"))}</td>
        <td class="num">${Number(r.quantity).toLocaleString("cs-CZ")}</td>
        <td>${escapeHtml(r.unit)}</td>
        ${showPrices ? `<td class="num">${r.unitPrice != null ? Number(r.unitPrice).toLocaleString("cs-CZ") : "—"}</td><td class="num">${val}</td>` : ""}
      </tr>`;
    })
    .join("");
  const priceHead = showPrices
    ? `<th class="num">Cena / MJ</th><th class="num">Hodnota</th>`
    : "";
  return `<table class="grid"><thead><tr>
    <th>Položka</th><th>SKU</th><th>Kategorie</th><th class="num">Množství</th><th>MJ</th>${priceHead}
  </tr></thead><tbody>${trs}</tbody></table>`;
}

function rowsCountSheet(items: WarehousePdfItemRow[], hideSystem: boolean, showPrices: boolean): string {
  const trs = items
    .map((r) => {
      const sys = r.systemDisplay?.trim()
        ? escapeHtml(r.systemDisplay)
        : `${Number(r.quantity).toLocaleString("cs-CZ")} ${escapeHtml(r.unit)}`;
      const priceCols = showPrices
        ? `<td class="num">${r.unitPrice != null ? Number(r.unitPrice).toLocaleString("cs-CZ") : "—"}</td>
           <td class="num">${r.unitPrice != null ? formatInventoryMoneyCzk(Number(r.quantity) * Number(r.unitPrice)) : "—"}</td>`
        : "";
      return `<tr style="height: 2.2em;">
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(String(r.sku ?? "—"))}</td>
        <td>${escapeHtml(r.unit)}</td>
        ${hideSystem ? "" : `<td class="num">${sys}</td>`}
        <td><span class="blank"></span></td>
        <td><span class="blank"></span></td>
        ${priceCols}
      </tr>`;
    })
    .join("");
  const sysHead = hideSystem ? "" : `<th class="num">Stav v systému</th>`;
  const priceHead = showPrices ? `<th class="num">Cena / MJ</th><th class="num">Hodnota</th>` : "";
  return `<table class="grid"><thead><tr>
    <th>Položka</th><th>SKU</th><th>MJ</th>${sysHead}<th>Skutečný stav</th><th>Rozdíl</th>${priceHead}
  </tr></thead><tbody>${trs}</tbody></table>`;
}

function profileAppendixHtml(items: WarehousePdfItemRow[]): string {
  const profileRows = items.filter((r) => r.systemDisplay?.includes("ks ×"));
  if (!profileRows.length) return "";
  const trs = profileRows
    .map(
      (r) => `<tr>
      <td>${escapeHtml(r.name)}</td>
      <td colspan="5">
        <div style="font-size:8.5pt;color:#475569;margin-bottom:4px">${escapeHtml(r.systemDisplay ?? "")}</div>
        <table style="width:100%;border-collapse:collapse;font-size:8.5pt">
          <tr><th style="border:1px solid #cbd5e1;padding:4px">Počet celých tyčí</th><th style="border:1px solid #cbd5e1;padding:4px">Délka tyče (mm)</th><th style="border:1px solid #cbd5e1;padding:4px">Načaté / zbytky (délky mm)</th></tr>
          <tr><td style="border:1px solid #cbd5e1;padding:8px;height:2em"><span class="blank"></span></td><td style="border:1px solid #cbd5e1;padding:8px"><span class="blank"></span></td><td style="border:1px solid #cbd5e1;padding:8px;height:3em"><span class="blank"></span></td></tr>
        </table>
      </td>
    </tr>`
    )
    .join("");
  return `<div class="summary"><strong>Doplňkový list — profily a zbytky</strong></div>
    <table class="grid"><tbody>${trs}</tbody></table>`;
}

function signatureBlockHtml(): string {
  return `<div class="sig-block">
    <div class="sig-row">
      <div class="sig-box"><strong>Pracovník</strong><br/><span class="blank"></span></div>
      <div class="sig-box"><strong>Datum</strong><br/><span class="blank"></span></div>
    </div>
    <div class="sig-box" style="margin-top:8px"><strong>Poznámky</strong><br/><span class="blank"></span><span class="blank"></span></div>
    <div class="sig-box" style="margin-top:8px"><strong>Podpis</strong><br/><span class="blank"></span></div>
  </div>`;
}

export function buildWarehouseInventoryPdfHtml(input: {
  kind: WarehousePdfExportKind;
  meta: WarehousePdfMeta;
  items: WarehousePdfItemRow[];
  hideSystemQuantity?: boolean;
  showPrices?: boolean;
  inventory?: Pick<WarehouseInventoryDoc, "inventoryNumber" | "lines" | "assignedWorkerName" | "notes">;
}): string {
  const { kind, meta, items } = input;
  const hideSystem = input.hideSystemQuantity === true;
  const showPrices = input.showPrices === true;
  const landscape = kind === "count_sheet";
  const bodyClass = landscape ? "landscape" : "";

  let table = "";
  if (kind === "count_sheet") {
    table = rowsCountSheet(items, hideSystem, showPrices);
  } else if (kind === "inventory_report" && input.inventory) {
    const trs = input.inventory.lines
      .map((line) => {
        const { diff, status } = computeLineDiff(line.systemQuantity, line.countedQuantity);
        const diffLabel =
          status === "unset"
            ? "—"
            : `${diff! >= 0 ? "+" : ""}${diff!.toLocaleString("cs-CZ")} ${line.unit}`;
        return `<tr>
          <td>${escapeHtml(line.name)}</td>
          <td>${escapeHtml(String(line.sku ?? "—"))}</td>
          <td class="num">${line.systemQuantity.toLocaleString("cs-CZ")}</td>
          <td class="num">${line.countedQuantity != null ? line.countedQuantity.toLocaleString("cs-CZ") : "—"}</td>
          <td class="num">${escapeHtml(diffLabel)}</td>
          <td>${escapeHtml(String(line.note ?? ""))}</td>
        </tr>`;
      })
      .join("");
    table = `<table class="grid"><thead><tr>
      <th>Položka</th><th>SKU</th><th class="num">Systém</th><th class="num">Skutečnost</th><th class="num">Rozdíl</th><th>Poznámka</th>
    </tr></thead><tbody>${trs}</tbody></table>`;
  } else {
    table = rowsStockList(items, kind === "valued_list" || showPrices);
  }

  const summary = `<p class="summary">Počet položek: <strong>${items.length.toLocaleString("cs-CZ")}</strong></p>`;
  const appendix = kind === "count_sheet" ? profileAppendixHtml(items) : "";
  const sig = kind === "count_sheet" ? signatureBlockHtml() : "";

  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/><style>${BASE_CSS}</style></head>
<body class="${bodyClass}">
<div class="sheet">
${headerHtml(meta)}
${table}
${summary}
${appendix}
${sig}
</div>
<div class="page-footer">RAJMONDATA · Sklad</div>
</body></html>`;
}
