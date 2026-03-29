/**
 * Měkké mazání dokladů / faktur — záznam zůstává ve Firestore.
 * Platí: chybějící pole i false znamenají „není smazaný“.
 */
export function isActiveFirestoreDoc(data: unknown): boolean {
  if (data == null || typeof data !== "object") return true;
  return (data as { isDeleted?: unknown }).isDeleted !== true;
}
