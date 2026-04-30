/**
 * Převod mezi souřadnicemi ukazatele (viewport) a bitmapou canvasu.
 * Canvas může mít CSS object-fit: contain — bitmapa nevyplní celý getBoundingClientRect().
 */

export type CanvasImagePoint = { x: number; y: number };

/** Vnitřní obdélník skutečně vykreslené bitmapy uvnitř elementu canvas (client / viewport). */
function getCanvasObjectFitContainRect(canvas: HTMLCanvasElement): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  const cw = canvas.width;
  const ch = canvas.height;
  if (cw <= 0 || ch <= 0) return null;
  const rect = canvas.getBoundingClientRect();
  const rw = rect.width;
  const rh = rect.height;
  if (rw <= 0 || rh <= 0) return null;
  const ar = cw / ch;
  const br = rw / rh;
  let innerW: number;
  let innerH: number;
  let ix0: number;
  let iy0: number;
  if (ar > br) {
    innerH = rh;
    innerW = rh * ar;
    iy0 = rect.top;
    ix0 = rect.left + (rw - innerW) / 2;
  } else {
    innerW = rw;
    innerH = rw / ar;
    ix0 = rect.left;
    iy0 = rect.top + (rh - innerH) / 2;
  }
  return { left: ix0, top: iy0, width: innerW, height: innerH };
}

/**
 * Client → souřadnice v pixelech bitmapy (0…canvas.width/height).
 * Vrátí null, pokud bod leží mimo vykreslenou bitmapu (letterbox).
 */
export function clientToCanvasImagePoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): CanvasImagePoint | null {
  const inner = getCanvasObjectFitContainRect(canvas);
  if (!inner) return null;
  const cw = canvas.width;
  const ch = canvas.height;
  if (
    clientX < inner.left ||
    clientX > inner.left + inner.width ||
    clientY < inner.top ||
    clientY > inner.top + inner.height
  ) {
    return null;
  }
  return {
    x: ((clientX - inner.left) / inner.width) * cw,
    y: ((clientY - inner.top) / inner.height) * ch,
  };
}

/** Jako {@link clientToCanvasImagePoint}, ale bod mimo bitmapu se promítne na nejbližší okraj (vhodné pro kreslení). */
export function clientToCanvasImagePointClamped(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): CanvasImagePoint {
  const inner = getCanvasObjectFitContainRect(canvas);
  const cw = Math.max(1, canvas.width);
  const ch = Math.max(1, canvas.height);
  if (!inner) {
    return { x: 0, y: 0 };
  }
  const px = Math.min(
    Math.max(clientX, inner.left),
    inner.left + inner.width
  );
  const py = Math.min(
    Math.max(clientY, inner.top),
    inner.top + inner.height
  );
  return {
    x: ((px - inner.left) / inner.width) * cw,
    y: ((py - inner.top) / inner.height) * ch,
  };
}

/** Střed bitmapy v client souřadnicích (střed „contain“ oblasti). */
export function canvasImageCenterClient(canvas: HTMLCanvasElement): {
  clientX: number;
  clientY: number;
} | null {
  const inner = getCanvasObjectFitContainRect(canvas);
  if (!inner) return null;
  return {
    clientX: inner.left + inner.width / 2,
    clientY: inner.top + inner.height / 2,
  };
}

/** Obrázek → client (střed pixelu). */
export function imageToClientPoint(
  canvas: HTMLCanvasElement,
  imageX: number,
  imageY: number
): { clientX: number; clientY: number } | null {
  const inner = getCanvasObjectFitContainRect(canvas);
  if (!inner) return null;
  const cw = canvas.width;
  const ch = canvas.height;
  if (cw <= 0 || ch <= 0) return null;
  return {
    clientX: inner.left + (imageX / cw) * inner.width,
    clientY: inner.top + (imageY / ch) * inner.height,
  };
}
