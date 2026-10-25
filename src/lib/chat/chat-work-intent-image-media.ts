import "server-only";

import sharp from "sharp";
import { OPENAI_DOCUMENT_MAX_BYTES } from "@/lib/ai/config";

const TILE_MAX_HEIGHT = 1800;
const TILE_OVERLAP = 220;
const MAX_TILES = 6;

export function resolveImageMimeType(
  buffer: Buffer,
  declaredMime: string,
  fileName: string
): string {
  const declared = String(declaredMime ?? "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (declared.startsWith("image/") && declared !== "image/jpg") {
    return declared === "image/jpg" ? "image/jpeg" : declared;
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }

  const fn = String(fileName ?? "").toLowerCase();
  if (fn.endsWith(".png")) return "image/png";
  if (fn.endsWith(".webp")) return "image/webp";
  if (fn.endsWith(".jpg") || fn.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

export type PreparedImageTile = {
  mimeType: string;
  base64: string;
  width: number;
  height: number;
  tileIndex: number;
  tileCount: number;
};

/** Připraví JPEG dlaždice pro dlouhé screenshoty (WhatsApp). */
export async function prepareImageTilesForVision(
  buffer: Buffer,
  mimeType: string
): Promise<PreparedImageTile[]> {
  if (!buffer.length || buffer.length > OPENAI_DOCUMENT_MAX_BYTES) {
    return [];
  }

  const image = sharp(buffer, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return [];

  const outMime = mimeType === "image/png" || mimeType === "image/webp" ? mimeType : "image/jpeg";

  async function encodeRegion(top: number, h: number, tileIndex: number, tileCount: number) {
    let pipeline = sharp(buffer, { failOn: "none" })
      .rotate()
      .extract({ left: 0, top, width, height: h });
    if (outMime === "image/jpeg") {
      pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });
    } else if (outMime === "image/png") {
      pipeline = pipeline.png({ compressionLevel: 8 });
    } else {
      pipeline = pipeline.webp({ quality: 88 });
    }
    const tileBuf = await pipeline.toBuffer();
    return {
      mimeType: outMime,
      base64: tileBuf.toString("base64"),
      width,
      height: h,
      tileIndex,
      tileCount,
    } satisfies PreparedImageTile;
  }

  if (height <= TILE_MAX_HEIGHT) {
    const full = await encodeRegion(0, height, 0, 1);
    return [full];
  }

  const tiles: PreparedImageTile[] = [];
  let top = 0;
  let idx = 0;
  while (top < height && idx < MAX_TILES) {
    const h = Math.min(TILE_MAX_HEIGHT, height - top);
    tiles.push(await encodeRegion(top, h, idx, 0));
    if (top + h >= height) break;
    top += TILE_MAX_HEIGHT - TILE_OVERLAP;
    idx += 1;
  }
  const tileCount = tiles.length;
  return tiles.map((t) => ({ ...t, tileCount }));
}
