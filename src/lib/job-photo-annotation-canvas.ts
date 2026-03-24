/**
 * Canvas vykreslování a geometrie poznámek u fotek zakázky (sdílené UI + export PNG).
 */

import type {
  DimensionColor,
  JobPhotoNoteAnnotation,
} from "./job-photo-annotations";

export type NoteLayout = {
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  cx: number;
  cy: number;
  explicitBox: boolean;
};

const NOTE_FILL_ALPHA = 0.22;

function wrapTextToLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const t = (text || "").trim();
  if (!t) return [""];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (ctx.measureText(trial).width <= maxWidth) {
      line = trial;
    } else {
      if (line) lines.push(line);
      if (ctx.measureText(w).width <= maxWidth) {
        line = w;
      } else {
        let chunk = "";
        for (const ch of w) {
          const next = chunk + ch;
          if (ctx.measureText(next).width <= maxWidth) chunk = next;
          else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        line = chunk;
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function computeNoteLayout(
  a: JobPhotoNoteAnnotation,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D | null,
  fontSize: number
): NoteLayout {
  const paddingX = Math.round(fontSize * 0.6);
  const paddingY = Math.round(fontSize * 0.45);
  const maxTextWidth = Math.max(240, Math.round(canvas.width * 0.35));

  if (
    typeof a.boxWidth === "number" &&
    typeof a.boxHeight === "number" &&
    a.boxWidth > 1 &&
    a.boxHeight > 1
  ) {
    return {
      boxX: a.boxX,
      boxY: a.boxY,
      boxW: a.boxWidth,
      boxH: a.boxHeight,
      cx: a.boxX + a.boxWidth / 2,
      cy: a.boxY + a.boxHeight / 2,
      explicitBox: true,
    };
  }

  const text = (a.text || "").trim();
  if (!ctx) {
    const estW = Math.min(
      text.length * fontSize * 0.55 + paddingX * 2,
      maxTextWidth + paddingX * 2
    );
    const boxH = fontSize + paddingY * 2;
    return {
      boxX: a.boxX,
      boxY: a.boxY,
      boxW: estW,
      boxH,
      cx: a.boxX + estW / 2,
      cy: a.boxY + boxH / 2,
      explicitBox: false,
    };
  }

  ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  const clipped = text.length > 200 ? `${text.slice(0, 200)}…` : text;
  const measured = Math.min(ctx.measureText(clipped).width, maxTextWidth);
  const boxW = measured + paddingX * 2;
  const boxH = fontSize + paddingY * 2;
  return {
    boxX: a.boxX,
    boxY: a.boxY,
    boxW,
    boxH,
    cx: a.boxX + boxW / 2,
    cy: a.boxY + boxH / 2,
    explicitBox: false,
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  if (h.length === 6) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

export function drawNoteAnnotationOnCanvas(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  a: JobPhotoNoteAnnotation,
  isSelected: boolean,
  opts: {
    fontSize: number;
    lineWidth: number;
    endpointRadius: number;
    arrowLen: number;
    colorToHex: (c: DimensionColor) => string;
  }
): void {
  const stroke = opts.colorToHex(a.color);
  const { fontSize, lineWidth, endpointRadius, arrowLen } = opts;
  const paddingX = Math.round(fontSize * 0.6);
  const paddingY = Math.round(fontSize * 0.45);

  ctx.lineWidth = isSelected ? lineWidth + 2 : lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;

  const layout = computeNoteLayout(a, canvas, ctx, fontSize);
  const { boxX, boxY, boxW, boxH, cx, cy } = layout;
  const showArrow = a.showArrow !== false;

  const drawArrowHead = (x: number, y: number, ang: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - arrowLen * Math.cos(ang - Math.PI / 6),
      y - arrowLen * Math.sin(ang - Math.PI / 6)
    );
    ctx.lineTo(
      x - arrowLen * Math.cos(ang + Math.PI / 6),
      y - arrowLen * Math.sin(ang + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  };

  if (showArrow) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(a.targetX, a.targetY);
    ctx.stroke();
    const angle = Math.atan2(a.targetY - cy, a.targetX - cx);
    drawArrowHead(a.targetX, a.targetY, angle, stroke);
  }

  const rgb = hexToRgb(stroke);
  ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${NOTE_FILL_ALPHA})`;
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.lineWidth = 2;
  ctx.strokeStyle = isSelected ? stroke : "rgba(255,255,255,0.45)";
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  const text = (a.text || "").trim();
  ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = stroke === "#ffffff" ? "#111827" : "#ffffff";

  const innerW = Math.max(4, boxW - paddingX * 2);
  const lineHeight = Math.round(fontSize * 1.15);
  const maxLines = Math.max(
    1,
    Math.floor((boxH - paddingY * 2) / lineHeight)
  );

  if (layout.explicitBox && text) {
    const lines = wrapTextToLines(ctx, text, innerW).slice(0, maxLines);
    let ty = boxY + paddingY + fontSize;
    for (const ln of lines) {
      ctx.fillText(ln, boxX + paddingX, ty);
      ty += lineHeight;
    }
  } else {
    const clipped = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    ctx.fillText(clipped, boxX + paddingX, boxY + paddingY + fontSize);
  }

  if (showArrow) {
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.arc(a.targetX, a.targetY, endpointRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (isSelected && layout.explicitBox) {
    const h = Math.max(12, Math.round(endpointRadius * 1.1));
    ctx.fillStyle = stroke;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.fillRect(boxX + boxW - h, boxY + boxH - h, h, h);
    ctx.strokeRect(boxX + boxW - h, boxY + boxH - h, h, h);
  }
}

export function noteResizeHandleSize(endpointRadius: number): number {
  return Math.max(12, Math.round(endpointRadius * 1.1));
}
