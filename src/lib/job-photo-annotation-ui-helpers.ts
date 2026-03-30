import type { JobPhotoAnnotationTarget } from "./job-media-types";

export function getScaleAwareSizes(canvas: HTMLCanvasElement) {
  const longest = Math.max(canvas.width, canvas.height);
  const scale = Math.max(1, longest / 1200);
  const fontSize = Math.round(25 * scale);
  const lineWidth = Math.max(6, Math.round(6 * scale));
  const endpointRadius = Math.max(8, Math.round(8 * scale));
  const arrowLen = Math.max(18, Math.round(18 * scale));
  const hitRadius = Math.max(18, Math.round(18 * scale));
  return { fontSize, lineWidth, endpointRadius, arrowLen, hitRadius };
}

export function getPhotoStorageFullPath(p: JobPhotoAnnotationTarget): string {
  const raw = p as Record<string, unknown>;
  const candidates = [raw.storagePath, raw.path, raw.fullPath];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}
