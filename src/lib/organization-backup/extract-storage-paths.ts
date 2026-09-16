import { STORAGE_PATH_KEYS } from "@/lib/organization-backup/constants";

const URL_STORAGE_HINT =
  /(?:firebase|googleapis|storage\.google)/i;

/** Rekurzivně najde storage cesty v exportovaném dokumentu. */
export function collectStoragePathsFromValue(
  value: unknown,
  organizationId: string,
  into: Set<string>
): void {
  if (value == null) return;
  if (typeof value === "string") {
    const s = value.trim();
    if (s.startsWith(`companies/${organizationId}/`)) {
      into.add(s);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStoragePathsFromValue(item, organizationId, into);
    return;
  }
  if (typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  for (const key of STORAGE_PATH_KEYS) {
    const v = row[key];
    if (typeof v === "string" && v.startsWith(`companies/${organizationId}/`)) {
      into.add(v.trim());
    }
  }
  if (typeof row.fileUrl === "string" && URL_STORAGE_HINT.test(row.fileUrl)) {
    const fromUrl = tryParseStoragePathFromUrl(row.fileUrl, organizationId);
    if (fromUrl) into.add(fromUrl);
  }
  if (typeof row.url === "string" && URL_STORAGE_HINT.test(row.url)) {
    const fromUrl = tryParseStoragePathFromUrl(row.url, organizationId);
    if (fromUrl) into.add(fromUrl);
  }
  for (const v of Object.values(row)) {
    collectStoragePathsFromValue(v, organizationId, into);
  }
}

function tryParseStoragePathFromUrl(url: string, organizationId: string): string | null {
  try {
    const u = new URL(url);
    const decoded = decodeURIComponent(u.pathname);
    const idx = decoded.indexOf(`companies/${organizationId}/`);
    if (idx >= 0) {
      return decoded.slice(idx).replace(/^\/o\//, "").split("?")[0];
    }
    const alt = decoded.match(/companies%2F[^/]+%2F[^?]+/);
    if (alt) {
      return decodeURIComponent(alt[0].replace(/%2F/g, "/"));
    }
  } catch {
    /* ignore */
  }
  return null;
}
