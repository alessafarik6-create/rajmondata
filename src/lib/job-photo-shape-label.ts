/**
 * Vykreslení a legenda pro anotace typu „značka / model“ (měřítkové značky).
 */

import type {
  AnnotationLegendEntry,
  DimensionColor,
  JobPhotoShapeLabelAnnotation,
} from "@/lib/job-photo-annotations";

export function buildLegendFromShapeLabels(
  items: JobPhotoShapeLabelAnnotation[]
): AnnotationLegendEntry[] {
  const sorted = [...items].sort(
    (a, b) => (a.legendNumber || 0) - (b.legendNumber || 0) || a.id.localeCompare(b.id)
  );
  const seen = new Set<number>();
  const out: AnnotationLegendEntry[] = [];
  for (const s of sorted) {
    const ln = Math.max(1, Math.floor(s.legendNumber || 1));
    if (seen.has(ln)) continue;
    seen.add(ln);
    out.push({
      legendNumber: ln,
      label: s.label || "",
      widthMm: s.widthMm,
      heightMm: s.heightMm,
      note: s.note?.trim() ? s.note.trim() : undefined,
    });
  }
  return out;
}

export function drawShapeLabelOnCanvas(
  ctx: CanvasRenderingContext2D,
  a: JobPhotoShapeLabelAnnotation,
  isSelected: boolean,
  coordScale: number,
  colorToHex: (c: DimensionColor) => string,
  fontSize: number,
  lineWidth: number
): void {
  const x = a.x * coordScale;
  const y = a.y * coordScale;
  const w = a.width * coordScale;
  const h = a.height * coordScale;
  const stroke = colorToHex(a.color);

  ctx.save();
  ctx.lineWidth = isSelected ? lineWidth + 1 : lineWidth;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = `${stroke}33`;

  if (a.shape === "point") {
    const r = Math.max(4, Math.min(w, h) / 2 || 4);
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (a.shape === "circle") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.max(1, Math.min(w, h) / 2);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  const labelText = (a.showLabelInline ? a.label : String(a.legendNumber)).trim();
  if (labelText) {
    const pad = Math.max(3, Math.round(fontSize * 0.25));
    ctx.font = `700 ${Math.max(10, Math.round(fontSize * 0.55))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(labelText).width;
    const boxW = tw + pad * 2;
    const boxH = Math.max(14, Math.round(fontSize * 0.75));
    const bx = x + w / 2 - boxW / 2;
    let by = y - boxH - 4;
    if (by < 2) by = y + h + 4;
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.fillStyle = "#fff";
    ctx.fillText(labelText, bx + pad, by + boxH / 2);
  }

  ctx.restore();
}

/** x,y v prostoru dokumentu (jako u kót), stejně jako a.x / a.width. */
export function hitTestShapeLabel(
  a: JobPhotoShapeLabelAnnotation,
  x: number,
  y: number,
  hitRadius: number,
  opts?: { lockResize?: boolean }
): "move" | "resize-br" | null {
  const ax = a.x;
  const ay = a.y;
  const aw = a.width;
  const ah = a.height;
  const lockResize = opts?.lockResize === true;

  if (a.shape === "circle" || a.shape === "point") {
    const cx = ax + aw / 2;
    const cy = ay + ah / 2;
    const r = a.shape === "point" ? Math.max(aw, ah) / 2 : Math.min(aw, ah) / 2;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist <= r + hitRadius) return "move";
    return null;
  }

  const br = hitRadius * 2;
  if (
    !lockResize &&
    x >= ax + aw - br &&
    x <= ax + aw + hitRadius &&
    y >= ay + ah - br &&
    y <= ay + ah + hitRadius
  ) {
    return "resize-br";
  }
  if (x >= ax && x <= ax + aw && y >= ay && y <= ay + ah) return "move";
  return null;
}

/** Spodní pruh legendy pod exportovaným obrázkem (px výška). */
export function estimateLegendStripHeight(
  ctx: CanvasRenderingContext2D,
  entries: AnnotationLegendEntry[],
  width: number
): number {
  if (!entries.length) return 0;
  const pad = 16;
  const lineH = 22;
  const titleH = 28;
  ctx.save();
  ctx.font = "15px ui-sans-serif, system-ui, sans-serif";
  let lines = 1;
  for (const e of entries) {
    const text = `${e.legendNumber} – ${e.label}, ${e.widthMm} × ${e.heightMm} mm${
      e.note ? ` (${e.note})` : ""
    }`;
    const maxW = Math.max(80, width - pad * 2);
    let lineW = 0;
    for (const ch of text) {
      const cw = ctx.measureText(ch).width;
      if (lineW + cw > maxW && lineW > 0) {
        lines++;
        lineW = cw;
      } else {
        lineW += cw;
      }
    }
    lines++;
  }
  ctx.restore();
  return pad * 2 + titleH + lines * lineH;
}

export function drawLegendStrip(
  ctx: CanvasRenderingContext2D,
  entries: AnnotationLegendEntry[],
  width: number,
  y0: number,
  height: number
): void {
  ctx.save();
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, y0, width, height);
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, y0 + 0.5, width - 1, height - 1);
  let y = y0 + 14;
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Legenda", 14, y);
  y += 26;
  ctx.font = "15px ui-sans-serif, system-ui, sans-serif";
  for (const e of entries) {
    const line = `${e.legendNumber} – ${e.label}, ${e.widthMm} × ${e.heightMm} mm${
      e.note ? ` — ${e.note}` : ""
    }`;
    wrapFillText(ctx, line, 14, y, width - 28, 20);
    y += 22;
  }
  ctx.restore();
}

function wrapFillText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineGap: number
): void {
  const words = text.split(/\s+/);
  let line = "";
  let yy = y;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      yy += lineGap;
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}
