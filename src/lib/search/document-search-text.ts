/**
 * Sestavení searchable textu z AI analýzy dokladu.
 */

import type { DocumentAiFormPatch } from "@/lib/ai/document-extraction-types";

export function buildDocumentSearchTextFromPatch(
  patch: DocumentAiFormPatch,
  extras?: { rawText?: string | null; fileName?: string | null }
): string {
  const parts = [
    patch.number,
    patch.entityName,
    patch.description,
    patch.date,
    patch.dueDate,
    patch.costCategory,
    patch.amount ? `castka ${patch.amount}` : null,
    extras?.fileName,
    extras?.rawText,
  ];
  return parts
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join("\n");
}
