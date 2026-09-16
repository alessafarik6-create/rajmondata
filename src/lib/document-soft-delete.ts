/**
 * Měkké mazání dokladů / faktur — záznam zůstává ve Firestore.
 * Platí: chybějící pole i false znamenají „není smazaný“.
 */
export function isActiveFirestoreDoc(data: unknown): boolean {
  if (data == null || typeof data !== "object") return true;
  const row = data as { isDeleted?: unknown; deletedAt?: unknown };
  if (row.isDeleted === true) return false;
  if (row.deletedAt != null) return false;
  return true;
}

export function activeFirestoreDocs<T>(list: T[] | null | undefined): T[] {
  const arr = Array.isArray(list) ? list : [];
  return arr.filter((row) => isActiveFirestoreDoc(row));
}
