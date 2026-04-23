/**
 * Jednotné určení URL náhledu skladové položky (různá pojmenování polí ve Firestore / importech).
 */

export function resolveInventoryItemImageUrl(
  item: Record<string, unknown> | null | undefined
): string {
  if (!item || typeof item !== "object") return "";
  const direct = [
    item.thumbnailUrl,
    item.thumbnailURL,
    item.imageUrl,
    item.imageURL,
    item.photoUrl,
    item.photoURL,
    item.pictureUrl,
    item.mainImageUrl,
  ];
  for (const c of direct) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s) return s;
  }
  const images = item.images;
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    if (typeof first === "string" && first.trim()) return first.trim();
    if (first && typeof first === "object") {
      const o = first as Record<string, unknown>;
      const nested = [o.url, o.imageUrl, o.downloadURL, o.src];
      for (const c of nested) {
        const s = typeof c === "string" ? c.trim() : "";
        if (s) return s;
      }
    }
  }
  return "";
}
