/** Limity a popisky pro znalostní bázi AI centra. */

export const AI_KNOWLEDGE_MAX_FILE_BYTES = 15 * 1024 * 1024;

export const AI_KNOWLEDGE_ACCEPT = ".pdf,.txt,.docx,application/pdf,text/plain";

export const AI_KNOWLEDGE_STATUS_LABELS: Record<string, string> = {
  uploading: "Nahrává se",
  pending: "Nahrává se",
  processing: "Zpracovává se",
  ready: "Připraveno",
  failed: "Chyba",
};

export function formatKnowledgeFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
