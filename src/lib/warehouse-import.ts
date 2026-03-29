/**
 * Parsování CSV a textu z PDF pro náhled importu do skladu (bez zápisu do DB).
 */

export type WarehouseImportDraftRow = {
  localId: string;
  name: string;
  sku: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  vatRate: number | null;
  supplier: string;
};

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function parseNumberCs(raw: string): number | null {
  const t = String(raw ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Jednoduchý CSV split s podporou uvozovek. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (!inQ && c === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/^"|"$/g, "").trim());
}

function detectDelimiter(headerLine: string): string {
  const sc = (headerLine.match(/;/g) || []).length;
  const cc = (headerLine.match(/,/g) || []).length;
  return sc >= cc ? ";" : ",";
}

type ColKey = "name" | "sku" | "quantity" | "unit" | "price" | "vat" | "supplier";

const HEADER_ALIASES: { key: ColKey; patterns: string[] }[] = [
  { key: "name", patterns: ["nazev", "name", "popis", "polozka", "zbozi", "material", "title"] },
  { key: "sku", patterns: ["kod", "sku", "code", "cislo", "ean", "artikl"] },
  { key: "quantity", patterns: ["mnozstvi", "mnozství", "qty", "quantity", "ks", "pocet", "počet"] },
  { key: "unit", patterns: ["jednotka", "unit", "mj", "j.", "j"] },
  { key: "price", patterns: ["cena", "price", "jc", "jednotkova cena", "cena za jednotku", "unitprice"] },
  { key: "vat", patterns: ["dph", "vat", "tax", "sazba"] },
  { key: "supplier", patterns: ["dodavatel", "supplier", "vyrobce", "výrobce"] },
];

function mapHeaders(headers: string[]): Partial<Record<ColKey, number>> {
  const norm = headers.map((h) => normalizeHeader(h));
  const map: Partial<Record<ColKey, number>> = {};
  for (let i = 0; i < norm.length; i++) {
    const cell = norm[i];
    for (const { key, patterns } of HEADER_ALIASES) {
      if (map[key] !== undefined) continue;
      if (patterns.some((p) => cell === p || cell.includes(p))) {
        map[key] = i;
        break;
      }
    }
  }
  return map;
}

function cellAt(cells: string[], col: Partial<Record<ColKey, number>>, key: ColKey, fallback = ""): string {
  const i = col[key];
  if (i === undefined || i < 0 || i >= cells.length) return fallback;
  return String(cells[i] ?? "").trim();
}

export function parseWarehouseImportCsv(text: string): WarehouseImportDraftRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const delim = detectDelimiter(lines[0]);
  const headerCells = splitCsvLine(lines[0], delim);
  const col = mapHeaders(headerCells);
  const hasHeader =
    col.name !== undefined ||
    col.quantity !== undefined ||
    col.price !== undefined ||
    normalizeHeader(headerCells[0]).includes("nazev") ||
    normalizeHeader(headerCells[0]).includes("name");

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows: WarehouseImportDraftRow[] = [];

  for (const line of dataLines) {
    const cells = splitCsvLine(line, delim);
    if (cells.every((c) => !c.trim())) continue;

    let name: string;
    let sku: string;
    let quantity: number;
    let unit: string;
    let unitPrice: number;
    let vatRate: number | null;
    let supplier: string;

    if (hasHeader && Object.keys(col).length > 0) {
      name = cellAt(cells, col, "name", cells[0] || "");
      sku = cellAt(cells, col, "sku");
      const q = parseNumberCs(cellAt(cells, col, "quantity", "1"));
      quantity = q != null && q > 0 ? q : 1;
      unit = cellAt(cells, col, "unit", "ks") || "ks";
      const p = parseNumberCs(cellAt(cells, col, "price", "0"));
      unitPrice = p != null && p >= 0 ? p : 0;
      const v = parseNumberCs(cellAt(cells, col, "vat", ""));
      vatRate = v != null && v >= 0 ? v : null;
      supplier = cellAt(cells, col, "supplier");
    } else {
      name = cells[0] || "";
      sku = cells[1] || "";
      const q = parseNumberCs(cells[2] ?? "1");
      quantity = q != null && q > 0 ? q : 1;
      unit = cells[3] || "ks";
      const p = parseNumberCs(cells[4] ?? "0");
      unitPrice = p != null && p >= 0 ? p : 0;
      const v = parseNumberCs(cells[5] ?? "");
      vatRate = v != null && v >= 0 ? v : null;
      supplier = cells[6] || "";
    }

    rows.push({
      localId: newId(),
      name,
      sku,
      quantity,
      unit: unit || "ks",
      unitPrice,
      vatRate,
      supplier,
    });
  }
  return rows;
}

/**
 * Extrahuje prostý text z PDF (pdfjs) — pouze v prohlížeči.
 */
export async function extractTextFromPdfBuffer(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const version = pdfjs.version || "4.10.38";
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const parts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lineMap = new Map<number, { x: number; str: string }[]>();
    for (const it of content.items) {
      if (!it || typeof it !== "object" || !("str" in it)) continue;
      const item = it as { str: string; transform?: number[] };
      const str = String(item.str ?? "").trim();
      if (!str) continue;
      const tr = item.transform;
      const y = tr && tr.length >= 6 ? Math.round(tr[5] * 10) / 10 : 0;
      const x = tr && tr.length >= 6 ? tr[4] : 0;
      const list = lineMap.get(y) ?? [];
      list.push({ x, str });
      lineMap.set(y, list);
    }
    const ys = [...lineMap.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const chunks = (lineMap.get(y) ?? []).sort((a, b) => a.x - b.x).map((c) => c.str);
      parts.push(chunks.join(" "));
    }
    parts.push("\n");
  }
  return parts.join("\n");
}

/**
 * Heuristika: řádky s textem + číslem (množství) + jednotka + případně cena.
 */
export function parseWarehouseImportPdfText(text: string): WarehouseImportDraftRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 3);

  const rows: WarehouseImportDraftRow[] = [];
  const unitWords = new Set(["ks", "kg", "m", "m2", "m3", "l", "bal", "krab", "pal", "hod", "db", "kompl", "sada"]);

  for (const line of lines) {
    if (/^(celkem|sum|dph|základ|zaklad|faktura|dodaci|objednávka|objednavka)/i.test(line)) continue;

    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;

    let qtyIdx = -1;
    let qty = 0;
    for (let i = Math.min(tokens.length - 1, 8); i >= 0; i--) {
      const n = parseNumberCs(tokens[i]);
      if (n != null && n >= 0 && n < 1e7) {
        qtyIdx = i;
        qty = n;
        break;
      }
    }
    if (qtyIdx < 1 || qty <= 0) continue;

    let unit = "ks";
    let unitIdx = qtyIdx + 1;
    if (unitIdx < tokens.length && unitWords.has(tokens[unitIdx].toLowerCase())) {
      unit = tokens[unitIdx].toLowerCase();
      unitIdx++;
    }

    let price = 0;
    for (let j = tokens.length - 1; j > unitIdx; j--) {
      const n = parseNumberCs(tokens[j]);
      if (n != null && n >= 0) {
        price = n;
        break;
      }
    }

    const nameTokens = tokens.slice(0, qtyIdx);
    const name = nameTokens.join(" ").replace(/^[\d.\s]+/, "").trim();
    if (!name || name.length < 2) continue;

    rows.push({
      localId: newId(),
      name,
      sku: "",
      quantity: qty,
      unit,
      unitPrice: price,
      vatRate: null,
      supplier: "",
    });
  }

  return dedupePdfRows(rows);
}

function dedupePdfRows(rows: WarehouseImportDraftRow[]): WarehouseImportDraftRow[] {
  const seen = new Set<string>();
  const out: WarehouseImportDraftRow[] = [];
  for (const r of rows) {
    const k = `${r.name.toLowerCase()}|${r.quantity}|${r.unitPrice}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export function validateImportRow(r: WarehouseImportDraftRow): string | null {
  if (!r.name.trim()) return "Název nesmí být prázdný.";
  if (!Number.isFinite(r.quantity) || r.quantity <= 0) return "Množství musí být kladné číslo.";
  if (!Number.isFinite(r.unitPrice) || r.unitPrice < 0) return "Cena musí být nezáporné číslo.";
  return null;
}
