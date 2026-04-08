import { escapeHtml, INVOICE_A4_SCREEN_AND_PRINT_CSS } from "@/lib/invoice-a4-html";

type MaterialOrderRow = {
  name: string;
  quantity: number;
  unit: string;
  note?: string | null;
  supplier?: string | null;
};

function brJoinEscaped(text: string): string {
  return String(text || "")
    .split("\n")
    .map((l) => escapeHtml(l.trim()))
    .filter(Boolean)
    .join("<br/>");
}

function fmtQty(q: number): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return "0";
  const s = n.toLocaleString("cs-CZ", { maximumFractionDigits: 3 });
  return s;
}

export function buildMaterialOrderHtml(params: {
  title?: string;
  companyName: string;
  jobName: string;
  jobNumber?: string | null;
  customerName: string;
  jobAddressLines: string;
  documentNumber: string;
  createdDateIso: string;
  items: MaterialOrderRow[];
  note?: string | null;
}): string {
  const rows = (params.items || []).filter((r) => String(r.name || "").trim());
  const itemsHtml =
    rows.length === 0
      ? `<tr><td colspan="5">—</td></tr>`
      : rows
          .map((r) => {
            const supplier = String(r.supplier ?? "").trim();
            return `<tr>
<td>${escapeHtml(String(r.name).trim())}</td>
<td class="num">${escapeHtml(fmtQty(r.quantity))}</td>
<td>${escapeHtml(String(r.unit || "ks").trim() || "ks")}</td>
<td>${escapeHtml(String(r.note ?? "").trim())}</td>
<td>${escapeHtml(supplier)}</td>
</tr>`;
          })
          .join("");

  const headerTitle = String(params.title || "Objednávka materiálu").trim();
  const jobNo = String(params.jobNumber ?? "").trim();
  const jobLabel = jobNo ? `${params.jobName} · ${jobNo}` : params.jobName;
  const note = String(params.note ?? "").trim();

  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8"/>
<style>${INVOICE_A4_SCREEN_AND_PRINT_CSS}</style>
<title>${escapeHtml(headerTitle)}</title>
</head>
<body>
<div class="a4-wrap">
  <div class="a4-sheet">
    <div class="doc-header">
      <div>
        <div class="doc-title">${escapeHtml(headerTitle)}</div>
        <div class="doc-meta">
          <p><strong>Číslo:</strong> ${escapeHtml(params.documentNumber)}</p>
          <p><strong>Datum:</strong> ${escapeHtml(params.createdDateIso)}</p>
          <p><strong>Zakázka:</strong> ${escapeHtml(jobLabel)}</p>
          <p><strong>Zákazník:</strong> ${escapeHtml(params.customerName)}</p>
        </div>
      </div>
      <div class="doc-meta" style="text-align:right">
        <strong>${escapeHtml(params.companyName)}</strong>
      </div>
    </div>

    <div class="grid2">
      <div class="box"><h3>Adresa zakázky</h3><div>${brJoinEscaped(params.jobAddressLines)}</div></div>
      <div class="box"><h3>Poznámka</h3><div>${brJoinEscaped(note || "—")}</div></div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Položka</th>
          <th class="num">Množství</th>
          <th>Jedn.</th>
          <th>Poznámka</th>
          <th>Dodavatel</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <p class="note">Vystavil: ____________________ · Převzal: ____________________</p>
  </div>
</div>
</body>
</html>`;
}

