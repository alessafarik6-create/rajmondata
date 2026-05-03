import { escapeHtml, INVOICE_A4_SCREEN_AND_PRINT_CSS } from "@/lib/invoice-a4-html";

function brJoinEscaped(text: string): string {
  return String(text || "")
    .split("\n")
    .map((l) => escapeHtml(l))
    .join("<br/>");
}

/**
 * Jednoduchá A4 šablona pro „rychlou objednávku materiálu“ — stejný CSS jako objednávky / faktury (PDF přes server).
 */
export function buildQuickMaterialOrderPdfHtml(params: {
  companyName: string;
  documentNumber: string;
  subject: string;
  jobLabel: string;
  customerLabel?: string | null;
  bodyText: string;
  note?: string | null;
  createdDateIso: string;
}): string {
  const note = String(params.note ?? "").trim();
  const cust = String(params.customerLabel ?? "").trim();
  const body = String(params.bodyText ?? "");

  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8"/>
<style>${INVOICE_A4_SCREEN_AND_PRINT_CSS}</style>
<title>${escapeHtml(params.subject)}</title>
</head>
<body>
<div class="a4-wrap">
  <div class="a4-sheet">
    <div class="doc-header">
      <div>
        <div class="doc-title">${escapeHtml(params.subject)}</div>
        <div class="doc-meta">
          <p><strong>Číslo:</strong> ${escapeHtml(params.documentNumber)}</p>
          <p><strong>Datum:</strong> ${escapeHtml(params.createdDateIso)}</p>
          <p><strong>Zakázka / kontext:</strong> ${escapeHtml(params.jobLabel)}</p>
          ${
            cust
              ? `<p><strong>Zákazník / pozn. kontext:</strong> ${escapeHtml(cust)}</p>`
              : ""
          }
        </div>
      </div>
      <div class="doc-meta" style="text-align:right">
        <strong>${escapeHtml(params.companyName)}</strong>
      </div>
    </div>

    <div class="box" style="margin-top:10px">
      <h3>Text objednávky</h3>
      <div style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:11px;line-height:1.45">${brJoinEscaped(
        body
      )}</div>
    </div>

    <div class="box" style="margin-top:10px">
      <h3>Poznámka</h3>
      <div>${note ? brJoinEscaped(note) : "—"}</div>
    </div>
  </div>
</div>
</body>
</html>`;
}
