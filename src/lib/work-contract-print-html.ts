/**
 * Standalone HTML document for work contract (screen, print, PDF via print-to-PDF).
 * Black on white, A4-oriented spacing, no external Tailwind build (embedded CSS).
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#039;";
      default:
        return ch;
    }
  });
}

export function withLineBreaks(value: string): string {
  if (!value) return "";
  return escapeHtml(value).replace(/\n/g, "<br/>");
}

/** First non-empty line for signature captions */
export function firstSignatoryLine(block: string): string {
  const plain = block
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ");
  const line = plain
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  return line || "………………………";
}

export type WorkContractPrintModel = {
  /** „default“ = klasická smlouva; „attachment“ = příloha k existující smlouvě */
  printVariant?: "default" | "attachment";
  /** Browser tab / PDF title */
  pageTitle: string;
  contractNumber: string;
  /** Per user request VS matches contract number string */
  variableSymbol: string;
  /** Already formatted (cs-CZ) */
  documentDate: string;
  /** Optional multi-line intro (legacy „hlavička“) */
  contractHeaderHtml: string;
  /** Main body after variable substitution */
  mainBodyHtml: string;
  additionalInfoHtml: string;
  zhotovitelHtml: string;
  objednatelHtml: string;
  /** Elektronický podpis organizace (zhotovitel) — URL (ideálně PNG s průhledným pozadím). */
  organizationSignatureUrl?: string | null;
  /** Job / summary (optional) */
  jobTitle?: string;
  jobDescription?: string;
  priceFormatted?: string;
  deadlineFormatted?: string;
  paymentTermsHtml: string;
  /**
   * Vnitřní HTML sekce „Data šablony“ (bez vnějšího &lt;section&gt;).
   * Pokud prázdné, sekce se do dokumentu nevloží.
   */
  templateDataSectionInnerHtml?: string;
  /** Nadřazená smlouva — jen u {@link printVariant} „attachment“ */
  parentContractNumber?: string;
  parentContractTitle?: string;
  /** Např. „Rezervační smlouva“, „Smlouva o dílo“ */
  parentContractKindLabel?: string;
};

const WORK_CONTRACT_PRINT_CSS = `
      :root {
        --ink: #0a0a0a;
        --muted: #404040;
        --border: #bdbdbd;
        --gap: 1.35rem;
      }
      * { box-sizing: border-box; }
      html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body {
        margin: 0;
        padding: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Sans", "Helvetica Neue", sans-serif;
        font-size: 11.5pt;
        line-height: 1.55;
        color: var(--ink);
        background: #ffffff;
      }
      .sheet {
        max-width: 800px;
        margin: 0 auto;
        padding: 28px 36px 40px;
        background: #fff;
      }
      @media print {
        @page {
          margin: 14mm 12mm 16mm;
          size: A4;
        }
        body { background: #fff !important; }
        .sheet {
          max-width: none;
          margin: 0;
          padding: 0;
        }
        .section { page-break-inside: avoid; }
        a { color: inherit; text-decoration: none; }
      }
      h1.doc-title {
        text-align: center;
        font-size: 22pt;
        font-weight: 800;
        letter-spacing: 0.04em;
        margin: 0 0 0.5rem;
        text-transform: uppercase;
      }
      .doc-sub {
        text-align: center;
        font-size: 10.5pt;
        color: var(--muted);
        margin: 0 0 1rem;
        line-height: 1.45;
      }
      .meta {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px 20px;
        margin: 1.25rem 0 1.75rem;
        padding: 14px 16px;
        border: 1px solid var(--border);
      }
      .meta.meta-attach {
        grid-template-columns: 1fr 1fr;
      }
      @media (max-width: 640px) {
        .meta { grid-template-columns: 1fr; }
      }
      .meta-item dt {
        font-size: 9pt;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
        margin: 0 0 4px;
      }
      .meta-item dd {
        margin: 0;
        font-size: 12pt;
        font-weight: 700;
      }
      .meta-item dd.mono {
        font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
        letter-spacing: 0.02em;
      }
      .intro {
        font-size: 10.5pt;
        color: var(--muted);
        margin-bottom: var(--gap);
        line-height: 1.5;
      }
      .section {
        margin-top: 1.6rem;
        padding-top: 0.35rem;
      }
      .section h2 {
        font-size: 11.5pt;
        font-weight: 800;
        margin: 0 0 0.65rem;
        padding-bottom: 6px;
        border-bottom: 2px solid var(--ink);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .party-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
      }
      @media (max-width: 640px) {
        .party-grid { grid-template-columns: 1fr; }
      }
      .party-card {
        border: 1px solid var(--border);
        padding: 14px 16px;
        min-height: 140px;
      }
      .party-card h3 {
        margin: 0 0 10px;
        font-size: 10.5pt;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .party-body {
        font-size: 10.8pt;
        line-height: 1.5;
      }
      .body-text {
        font-size: 11pt;
        line-height: 1.58;
      }
      .payment-details {
        border-left: 3px solid var(--ink);
        padding: 10px 12px 10px 14px;
        margin: 6px 0 0;
        background: #fff;
        color: var(--ink);
      }
      .muted { color: var(--muted); }
      .p { margin: 0 0 0.5rem; }
      .highlight-box {
        margin: 0;
        padding: 12px 14px;
        border: 1px solid var(--ink);
        background: #fafafa;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      @media print {
        .highlight-box { background: #fff; border-width: 1.5px; }
      }
      .hl-label {
        font-size: 9pt;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
      }
      .hl-value {
        font-size: 13pt;
        font-weight: 800;
      }
      .closing-static {
        font-size: 10.8pt;
        line-height: 1.55;
      }
      .signatures {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 32px;
        margin-top: 2.5rem;
        padding-top: 8px;
      }
      @media (max-width: 640px) {
        .signatures { grid-template-columns: 1fr; }
      }
      .sign-block h3 {
        margin: 0 0 20px;
        font-size: 10pt;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .sign-line {
        border-bottom: 1px solid var(--ink);
        min-height: 44px;
        margin-bottom: 8px;
        position: relative;
        overflow: hidden;
      }
      .org-signature {
        position: absolute;
        left: 0;
        bottom: 2px;
        max-width: 100%;
        max-height: 42px;
        object-fit: contain;
        /* Snaha o ostřejší raster při tisku */
        image-rendering: -webkit-optimize-contrast;
      }
      .sign-name {
        font-size: 10pt;
        color: var(--muted);
      }
      .template-data-section {
        border-top: 1px solid var(--border);
        padding-top: 1.1rem;
        margin-top: 1.5rem;
      }
      .template-data-lead {
        font-size: 9.5pt;
        color: var(--muted);
        margin: 0 0 0.85rem;
        line-height: 1.45;
      }
      .template-data-inner .tmpl-caption {
        font-size: 10.5pt;
        font-weight: 700;
        margin: 0 0 0.75rem;
      }
      .template-data-inner .tmpl-subsec {
        margin-top: 0.9rem;
      }
      .template-data-inner .tmpl-subsec h4 {
        font-size: 10.5pt;
        font-weight: 800;
        margin: 0 0 0.45rem;
        text-transform: none;
        letter-spacing: 0.02em;
        border-bottom: none;
        padding-bottom: 0;
      }
      .tmpl-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 10.5pt;
        line-height: 1.45;
      }
      .tmpl-table td {
        padding: 6px 10px;
        border: 1px solid var(--border);
        vertical-align: top;
      }
      .tmpl-table .td-label {
        font-weight: 700;
        width: 36%;
        background: #f5f5f5;
        color: var(--ink);
      }
      .tmpl-table .td-val { background: #fff; }
      @media print {
        .tmpl-table .td-label { background: #fff; }
      }
`;

function buildWorkContractAttachmentPrintHtml(m: WorkContractPrintModel): string {
  const pageTitle = escapeHtml(m.pageTitle || "Příloha ke smlouvě");
  const attNum =
    m.contractNumber.trim() || "— (číslo bude přiděleno při uložení)";
  const parentNum = (m.parentContractNumber || "").trim() || "—";
  const parentTitle = (m.parentContractTitle || "").trim() || "—";
  const parentKind = (m.parentContractKindLabel || "").trim();
  const dateLine = m.documentDate.trim() || "—";

  const hasHeader =
    m.contractHeaderHtml &&
    m.contractHeaderHtml.replace(/<br\/>/g, " ").replace(/&nbsp;/g, " ").trim()
      .length > 0;

  const jobTitle = (m.jobTitle || "").trim();
  const jobDesc = (m.jobDescription || "").trim();
  const price = (m.priceFormatted || "").trim();
  const deadline = (m.deadlineFormatted || "").trim();

  const zakazkaInner =
    jobTitle || jobDesc
      ? `<p class="p">${jobTitle ? `<strong>${escapeHtml(jobTitle)}</strong>` : ""}</p>${
          jobDesc
            ? `<div class="body-text">${withLineBreaks(jobDesc)}</div>`
            : ""
        }`
      : `<p class="muted">—</p>`;

  const cenaInner = price
    ? `<p class="highlight-box"><span class="hl-label">Rozpočet / cena (pokud uvedeno)</span><span class="hl-value">${escapeHtml(
        price
      )}</span></p>`
    : `<p class="muted">Údaj není u zakázky vyplněn.</p>`;

  const terminInner = deadline
    ? `<p class="highlight-box"><span class="hl-label">Termín</span><span class="hl-value">${escapeHtml(
        deadline
      )}</span></p>`
    : `<p class="muted">Termín není u zakázky vyplněn.</p>`;

  const fulfillmentInner =
    m.mainBodyHtml && m.mainBodyHtml.replace(/<br\/>/g, "").trim()
      ? `<div class="body-text">${m.mainBodyHtml}</div>`
      : `<p class="muted">—</p>`;

  const noteInner =
    m.additionalInfoHtml &&
    m.additionalInfoHtml.replace(/<br\/>/g, "").trim()
      ? `<div class="body-text">${m.additionalInfoHtml}</div>`
      : "";

  const zhot = firstSignatoryLine(m.zhotovitelHtml);
  const objed = firstSignatoryLine(m.objednatelHtml);
  const orgSigUrl = String(m.organizationSignatureUrl ?? "").trim();
  const orgSigImg = orgSigUrl
    ? `<img class="org-signature" alt="Podpis organizace" src="${escapeHtml(orgSigUrl)}" />`
    : "";

  const subline = parentNum && parentNum !== "—"
    ? `Příloha ke smlouvě č. ${escapeHtml(parentNum)}`
    : "Příloha ke smlouvě";

  const templateDataBlock = m.templateDataSectionInnerHtml?.trim()
    ? `<section class="section template-data-section">
        <h2>Data šablony zakázky</h2>
        <p class="template-data-lead">Údaje z vyplněné šablony u zakázky.</p>
        ${m.templateDataSectionInnerHtml}
      </section>`
    : "";

  const parentKindBlock = parentKind
    ? `<div class="meta-item">
          <dt>Typ nadřazené smlouvy</dt>
          <dd>${escapeHtml(parentKind)}</dd>
        </div>`
    : "";

  return `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${pageTitle}</title>
    <style>${WORK_CONTRACT_PRINT_CSS}
    </style>
  </head>
  <body>
    <article class="sheet">
      <h1 class="doc-title">${pageTitle}</h1>
      <p class="doc-sub">${subline}${parentTitle && parentTitle !== "—" ? ` — ${escapeHtml(parentTitle)}` : ""}</p>

      <dl class="meta meta-attach">
        <div class="meta-item">
          <dt>Číslo přílohy</dt>
          <dd class="mono">${escapeHtml(attNum)}</dd>
        </div>
        <div class="meta-item">
          <dt>Datum</dt>
          <dd>${escapeHtml(dateLine)}</dd>
        </div>
        <div class="meta-item">
          <dt>Číslo smlouvy (nadřazené)</dt>
          <dd class="mono">${escapeHtml(parentNum)}</dd>
        </div>
        <div class="meta-item">
          <dt>Název smlouvy (nadřazené)</dt>
          <dd>${escapeHtml(parentTitle)}</dd>
        </div>
        ${parentKindBlock}
      </dl>

      ${
        hasHeader
          ? `<div class="intro section">${m.contractHeaderHtml}</div>`
          : ""
      }

      <section class="section">
        <h2>Smluvní strany</h2>
        <div class="party-grid">
          <div class="party-card">
            <h3>Zhotovitel</h3>
            <div class="party-body">${m.zhotovitelHtml}</div>
          </div>
          <div class="party-card">
            <h3>Objednatel</h3>
            <div class="party-body">${m.objednatelHtml}</div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Údaje zakázky</h2>
        ${zakazkaInner}
        <div class="section" style="margin-top:1rem;padding-top:0">
          <h2 style="font-size:10.5pt;border:none;padding:0;margin:0 0 0.5rem">Cena a termín (souhrn)</h2>
          ${cenaInner}
          <div style="height:0.75rem"></div>
          ${terminInner}
        </div>
      </section>

      <section class="section">
        <h2>Obsah plnění zakázky</h2>
        ${fulfillmentInner}
      </section>

      ${templateDataBlock}

      ${
        noteInner
          ? `<section class="section">
        <h2>Poznámka</h2>
        ${noteInner}
      </section>`
          : ""
      }

      <section class="section">
        <h2>Podpisy</h2>
        <p class="muted" style="font-size:10pt;margin:0 0 1rem">Strany stvrzují obsah této přílohy ve vztahu k uvedené smlouvě.</p>
        <div class="signatures">
          <div class="sign-block">
            <h3>Zhotovitel</h3>
            <div class="sign-line">${orgSigImg}</div>
            <div class="sign-name">${escapeHtml(zhot)}</div>
          </div>
          <div class="sign-block">
            <h3>Objednatel</h3>
            <div class="sign-line"></div>
            <div class="sign-name">${escapeHtml(objed)}</div>
          </div>
        </div>
      </section>
    </article>
  </body>
</html>`;
}

const CLOSING_BOILERPLATE = `Smlouva je vyhotovena ve dvou stejnopisech, z nichž každá smluvní strana obdrží po jednom.
Nedílnou součástí této smlouvy mohou být přílohy, pokud jsou výslovně uvedeny a podepsány smluvními stranami.`;

export function buildWorkContractPrintHtml(m: WorkContractPrintModel): string {
  if (m.printVariant === "attachment") {
    return buildWorkContractAttachmentPrintHtml(m);
  }

  const num = m.contractNumber.trim() || "— (číslo bude přiděleno při uložení)";
  const vs = m.variableSymbol.trim() || num;
  const dateLine = m.documentDate.trim() || "—";

  const hasHeader =
    m.contractHeaderHtml &&
    m.contractHeaderHtml.replace(/<br\/>/g, " ").replace(/&nbsp;/g, " ").trim()
      .length > 0;

  const jobTitle = (m.jobTitle || "").trim();
  const jobDesc = (m.jobDescription || "").trim();
  const price = (m.priceFormatted || "").trim();
  const deadline = (m.deadlineFormatted || "").trim();

  const predmetInner =
    jobTitle || jobDesc
      ? `<p class="p">${jobTitle ? `<strong>${jobTitle}</strong>` : ""}</p>${
          jobDesc
            ? `<div class="body-text">${withLineBreaks(jobDesc)}</div>`
            : ""
        }`
      : `<p class="muted">Přesně specifikováno v textu smlouvy níže.</p>`;

  const cenaInner = price
    ? `<p class="highlight-box"><span class="hl-label">Celková cena díla</span><span class="hl-value">${escapeHtml(
        price
      )}</span></p>`
    : `<p class="muted">Cena díla je uvedena v textu smlouvy níže, případně v návazné cenové nabídce.</p>`;

  const terminInner = deadline
    ? `<p class="highlight-box"><span class="hl-label">Termín dokončení / plnění</span><span class="hl-value">${escapeHtml(
        deadline
      )}</span></p>`
    : `<p class="muted">Termín plnění je uveden v textu smlouvy níže, případně ve výkazu díla.</p>`;

  const payInner =
    m.paymentTermsHtml && m.paymentTermsHtml.replace(/<br\/>/g, "").trim()
      ? `<div class="body-text payment-details">${m.paymentTermsHtml}</div>`
      : `<p class="muted">Platební podmínky jsou rozvedeny v textu smlouvy níže.</p>`;

  const addInner =
    m.additionalInfoHtml &&
    m.additionalInfoHtml.replace(/<br\/>/g, "").trim()
      ? `<div class="body-text">${m.additionalInfoHtml}</div>`
      : "";

  const zhot = firstSignatoryLine(m.zhotovitelHtml);
  const objed = firstSignatoryLine(m.objednatelHtml);
  const orgSigUrl = String(m.organizationSignatureUrl ?? "").trim();
  const orgSigImg = orgSigUrl
    ? `<img class="org-signature" alt="Podpis organizace" src="${escapeHtml(orgSigUrl)}" />`
    : "";

  const pageTitle = escapeHtml(m.pageTitle || "Smlouva o dílo");

  const templateDataBlock = m.templateDataSectionInnerHtml?.trim()
    ? `<section class="section template-data-section">
        <h2>Data šablony</h2>
        <p class="template-data-lead">Specifikace zaměření a dalších polí dle vyplněné šablony zakázky.</p>
        ${m.templateDataSectionInnerHtml}
      </section>`
    : "";

  return `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${pageTitle}</title>
    <style>${WORK_CONTRACT_PRINT_CSS}</style>
  </head>
  <body>
    <article class="sheet">
      <h1 class="doc-title">${pageTitle}</h1>

      <dl class="meta">
        <div class="meta-item">
          <dt>Číslo smlouvy</dt>
          <dd class="mono">${escapeHtml(num)}</dd>
        </div>
        <div class="meta-item">
          <dt>Variabilní symbol</dt>
          <dd class="mono">${escapeHtml(vs)}</dd>
        </div>
        <div class="meta-item">
          <dt>Datum</dt>
          <dd>${escapeHtml(dateLine)}</dd>
        </div>
      </dl>

      ${
        hasHeader
          ? `<div class="intro section">${m.contractHeaderHtml}</div>`
          : ""
      }

      <section class="section">
        <h2>Smluvní strany</h2>
        <div class="party-grid">
          <div class="party-card">
            <h3>Zhotovitel</h3>
            <div class="party-body">${m.zhotovitelHtml}</div>
          </div>
          <div class="party-card">
            <h3>Objednatel</h3>
            <div class="party-body">${m.objednatelHtml}</div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Předmět smlouvy</h2>
        ${predmetInner}
      </section>

      ${templateDataBlock}

      <section class="section">
        <h2>Cena díla</h2>
        ${cenaInner}
      </section>

      <section class="section">
        <h2>Termín plnění</h2>
        ${terminInner}
      </section>

      <section class="section">
        <h2>Platební podmínky</h2>
        ${payInner}
      </section>

      <section class="section">
        <h2>Práva a povinnosti</h2>
        <div class="body-text">${
          m.mainBodyHtml && m.mainBodyHtml.replace(/<br\/>/g, "").trim()
            ? m.mainBodyHtml
            : `<p class="muted">—</p>`
        }</div>
      </section>

      <section class="section">
        <h2>Závěrečná ustanovení</h2>
        <div class="closing-static">
          <p>${escapeHtml(CLOSING_BOILERPLATE)}</p>
          ${addInner ? `<div style="margin-top:1rem">${addInner}</div>` : ""}
        </div>
      </section>

      <section class="section">
        <h2>Podpisy</h2>
        <div class="signatures">
          <div class="sign-block">
            <h3>Zhotovitel</h3>
            <div class="sign-line">${orgSigImg}</div>
            <div class="sign-name">${escapeHtml(zhot)}</div>
          </div>
          <div class="sign-block">
            <h3>Objednatel</h3>
            <div class="sign-line"></div>
            <div class="sign-name">${escapeHtml(objed)}</div>
          </div>
        </div>
      </section>
    </article>
  </body>
</html>`;
}
