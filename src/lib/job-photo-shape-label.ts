/**
 * Vykreslení a legenda pro anotace typu „značka / model“ (měřítkové značky).
 */

import {
  resolveShapeLabelStrokeCss,
  type AnnotationLegendEntry,
  type DimensionColor,
  type JobPhotoShapeLabelAnnotation,
} from "@/lib/job-photo-annotations";
import {
  effectiveShapeLabelMm,
  normalizeShapeLabelRotationDeg,
} from "@/lib/shape-label-mm-scale";

/** Jeden řádek legendy (editor + export PNG). */
export function formatLegendEntryLine(e: AnnotationLegendEntry): string {
  if (e.arrowNote) {
    return `${e.legendNumber} – ${(e.label || "").trim()}`;
  }
  let s = `${e.legendNumber} – ${e.label}, ${e.widthMm} × ${e.heightMm} mm`;
  const ld = e.legendDescription?.trim();
  if (ld) s += `, ${ld}`;
  const nt = e.note?.trim();
  if (nt) s += ` — ${nt}`;
  return s;
}

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
    const effMm = effectiveShapeLabelMm(s.widthMm, s.heightMm);
    out.push({
      legendNumber: ln,
      label: s.label || "",
      widthMm: effMm.widthMm,
      heightMm: effMm.heightMm,
      legendDescription: s.legendDescription?.trim() ? s.legendDescription.trim() : undefined,
      note: s.note?.trim() ? s.note.trim() : undefined,
      strokeHex: resolveShapeLabelStrokeCss(s),
    });
  }
  return out;
}

function shapeLabelRotationRad(a: JobPhotoShapeLabelAnnotation): number {
  return (normalizeShapeLabelRotationDeg(Number(a.rotation ?? 0)) * Math.PI) / 180;
}

/** Dokumentové souřadnice středu úchopu rotace (nad horní hranou ve směru „nahoru“ od boxu). */
export function shapeLabelRotateHandleDoc(
  a: JobPhotoShapeLabelAnnotation
): { hx: number; hy: number } {
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;
  const aw = a.width;
  const ah = a.height;
  const R = shapeLabelRotationRad(a);
  const pad = Math.max(8, Math.min(aw, ah) * 0.1);
  const lx = 0;
  const ly = -(ah / 2 + pad);
  const hx = cx + lx * Math.cos(R) - ly * Math.sin(R);
  const hy = cy + lx * Math.sin(R) + ly * Math.cos(R);
  return { hx, hy };
}

function docPointToShapeLocal(
  a: JobPhotoShapeLabelAnnotation,
  x: number,
  y: number
): { lx: number; ly: number } {
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;
  const R = shapeLabelRotationRad(a);
  const dx = x - cx;
  const dy = y - cy;
  const lx = dx * Math.cos(R) + dy * Math.sin(R);
  const ly = -dx * Math.sin(R) + dy * Math.cos(R);
  return { lx, ly };
}

export function drawShapeLabelOnCanvas(
  ctx: CanvasRenderingContext2D,
  a: JobPhotoShapeLabelAnnotation,
  isSelected: boolean,
  coordScale: number,
  _colorToHex: (c: DimensionColor) => string,
  _fontSize: number,
  lineWidth: number
): void {
  const x = a.x * coordScale;
  const y = a.y * coordScale;
  const w = a.width * coordScale;
  const h = a.height * coordScale;
  const stroke = resolveShapeLabelStrokeCss(a);
  const R = shapeLabelRotationRad(a);
  const cx = x + w / 2;
  const cy = y + h / 2;

  ctx.save();
  ctx.lineWidth = isSelected ? lineWidth + 1 : lineWidth;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = `${stroke}33`;

  ctx.translate(cx, cy);
  ctx.rotate(R);
  ctx.translate(-w / 2, -h / 2);

  if (a.shape === "point") {
    const r = Math.max(0.5, Math.min(w, h) / 2);
    const pcx = w / 2;
    const pcy = h / 2;
    ctx.beginPath();
    ctx.arc(pcx, pcy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (a.shape === "circle") {
    const pcx = w / 2;
    const pcy = h / 2;
    const r = Math.max(1, Math.min(w, h) / 2);
    ctx.beginPath();
    ctx.arc(pcx, pcy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(0, 0, w, h);
    ctx.strokeRect(0, 0, w, h);
  }

  const labelText = (a.showLabelInline ? a.label : String(a.legendNumber)).trim();
  if (labelText) {
    const short = Math.max(1e-6, Math.min(w, h));
    let fontPx = Math.round(short * 0.48);
    fontPx = Math.max(8, Math.min(56, fontPx));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
    const maxTw = Math.max(1, w * 0.9);
    while (fontPx > 8 && ctx.measureText(labelText).width > maxTw) {
      fontPx -= 1;
      ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
    }
    const tcx = w / 2;
    const tcy = h / 2;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = Math.max(1, fontPx * 0.08);
    ctx.strokeText(labelText, tcx, tcy);
    ctx.fillText(labelText, tcx, tcy);
  }

  ctx.restore();

  if (isSelected) {
    const { hx, hy } = shapeLabelRotateHandleDoc(a);
    const hsx = hx * coordScale;
    const hsy = hy * coordScale;
    const hr = Math.max(4, 5 * Math.min(1.2, coordScale));
    ctx.save();
    ctx.beginPath();
    ctx.arc(hsx, hsy, hr, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = Math.max(1, 1.25 * coordScale);
    ctx.fill();
    ctx.stroke();
    const deg = Math.round(normalizeShapeLabelRotationDeg(Number(a.rotation ?? 0)));
    ctx.font = `${Math.max(9, Math.round(11 * coordScale))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${deg}°`, hsx + hr + 3, hsy + 3);
    ctx.restore();
  }
}

/** x,y v prostoru dokumentu (jako u kót), stejně jako a.x / a.width. */
export function hitTestShapeLabel(
  a: JobPhotoShapeLabelAnnotation,
  x: number,
  y: number,
  hitRadius: number,
  opts?: { lockResize?: boolean; enableRotateHandle?: boolean }
): "rotate" | "move" | "resize-br" | null {
  const lockResize = opts?.lockResize === true;
  const enableRotate = opts?.enableRotateHandle === true;
  const ax = a.x;
  const ay = a.y;
  const aw = a.width;
  const ah = a.height;

  if (enableRotate) {
    const { hx, hy } = shapeLabelRotateHandleDoc(a);
    const handleR = Math.max(5, hitRadius * 0.9);
    if (Math.hypot(x - hx, y - hy) <= handleR + hitRadius) {
      return "rotate";
    }
  }

  const { lx, ly } = docPointToShapeLocal(a, x, y);

  if (a.shape === "circle" || a.shape === "point") {
    const r = Math.min(aw, ah) / 2;
    const dist = Math.hypot(lx, ly);
    if (dist <= r + hitRadius) return "move";
    return null;
  }

  const br = hitRadius * 2;
  if (
    !lockResize &&
    lx >= aw / 2 - br &&
    lx <= aw / 2 + hitRadius &&
    ly >= ah / 2 - br &&
    ly <= ah / 2 + hitRadius
  ) {
    return "resize-br";
  }
  const pad = hitRadius * 1.35;
  if (lx >= -aw / 2 - pad && lx <= aw / 2 + pad && ly >= -ah / 2 - pad && ly <= ah / 2 + pad) {
    return "move";
  }
  return null;
}

/** Spodní pruh legendy pod exportovaným obrázkem (px výška). */
function countWrappedLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number
): number {
  let lines = 0;
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
  return lines + (lineW > 0 ? 1 : 0);
}

export function estimateLegendStripHeight(
  ctx: CanvasRenderingContext2D,
  entries: AnnotationLegendEntry[],
  width: number
): number {
  if (!entries.length) return 0;
  const pad = 18;
  const lineH = 30;
  const mainTitleH = 38;
  const subTitleH = 28;
  const shapes = entries.filter((e) => !e.arrowNote);
  const arrows = entries.filter((e) => e.arrowNote);
  ctx.save();
  ctx.font = "18px ui-sans-serif, system-ui, sans-serif";
  const maxW = Math.max(80, width - pad * 2);
  let lines = 1;
  for (const e of shapes) {
    lines += countWrappedLines(ctx, formatLegendEntryLine(e), maxW);
  }
  if (arrows.length) {
    lines += 1;
    ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
    lines += countWrappedLines(ctx, "Poznámky / Šipky", maxW);
    ctx.font = "18px ui-sans-serif, system-ui, sans-serif";
    for (const e of arrows) {
      lines += countWrappedLines(ctx, formatLegendEntryLine(e), maxW);
    }
  }
  ctx.restore();
  const titleBlock = mainTitleH + (arrows.length ? subTitleH : 0);
  return pad * 2 + titleBlock + lines * lineH;
}

export function drawLegendStrip(
  ctx: CanvasRenderingContext2D,
  entries: AnnotationLegendEntry[],
  width: number,
  y0: number,
  height: number
): void {
  ctx.save();
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, y0, width, height);
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, y0 + 0.5, width - 1, height - 1);
  let y = y0 + 20;
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 22px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Legenda", 16, y);
  y += 36;
  ctx.font = "500 18px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "#e2e8f0";
  const shapes = entries.filter((e) => !e.arrowNote);
  const arrows = entries.filter((e) => e.arrowNote);
  for (const e of shapes) {
    const line = formatLegendEntryLine(e);
    wrapFillText(ctx, line, 16, y, width - 32, 30);
    y += 30;
  }
  if (arrows.length) {
    y += 6;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
    wrapFillText(ctx, "Poznámky / Šipky", 16, y, width - 32, 26);
    y += 28;
    ctx.font = "500 18px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#e2e8f0";
    for (const e of arrows) {
      const line = formatLegendEntryLine(e);
      wrapFillText(ctx, line, 16, y, width - 32, 30);
      y += 30;
    }
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
