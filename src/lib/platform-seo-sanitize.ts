/**
 * Sanitace SEO dokumentu (platform_seo/home) — superadmin PUT + konzistence dat.
 */

export type PlatformSeoHeroImage = {
  url: string;
  storagePath: string;
  alt: string;
  order: number;
};

export type PlatformSeoPromoVideo = {
  url: string;
  storagePath: string | null;
  type: "file" | "embed";
};

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

export function sanitizeHeroImages(raw: unknown): PlatformSeoHeroImage[] {
  if (!Array.isArray(raw)) return [];
  const out: PlatformSeoHeroImage[] = [];
  let order = 0;
  for (const row of raw.slice(0, 12)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const url = str(o.url, 2000);
    const storagePath = str(o.storagePath, 500);
    if (!url || !storagePath) continue;
    if (!storagePath.startsWith("platform/landing/")) continue;
    const alt = str(o.alt, 500);
    out.push({
      url,
      storagePath,
      alt: alt || "Ilustrace platformy",
      order: typeof o.order === "number" && Number.isFinite(o.order) ? o.order : order++,
    });
  }
  out.sort((a, b) => a.order - b.order);
  return out.map((h, i) => ({ ...h, order: i }));
}

export function sanitizePromoVideo(raw: unknown): PlatformSeoPromoVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = str(o.url, 2000);
  if (!url) return null;
  const type = o.type === "embed" ? "embed" : "file";
  const storagePath = o.storagePath != null ? str(o.storagePath, 500) : null;
  if (storagePath && !storagePath.startsWith("platform/landing/")) {
    return { url, storagePath: null, type };
  }
  return {
    url,
    storagePath: storagePath && storagePath.length > 0 ? storagePath : null,
    type,
  };
}
