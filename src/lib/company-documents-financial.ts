/**
 * Firemní sekce „Doklady“ zobrazuje pouze finanční doklady (částka &gt; 0).
 * Zrcadlení médií zakázky (fotky bez částky) a podobné záznamy se nepočítají.
 */

import { JOB_EXPENSE_DOCUMENT_SOURCE } from "@/lib/job-expense-document-sync";
import { JOB_MEDIA_DOCUMENT_SOURCE } from "@/lib/job-linked-document-sync";

export type CompanyDocumentLike = {
  source?: string;
  sourceType?: string;
  castka?: unknown;
  amountNet?: unknown;
  amount?: unknown;
  amountGross?: unknown;
};

/**
 * Řádek patří do přehledu dokladů (má evidovanou částku), není čistě fotodokumentace.
 */
export function isFinancialCompanyDocument(row: CompanyDocumentLike): boolean {
  const fromJobMedia =
    row.source === JOB_MEDIA_DOCUMENT_SOURCE || row.sourceType === "job";
  if (fromJobMedia) return false;

  const c = Number(row.castka ?? 0);
  const net = Number(row.amountNet ?? row.amount ?? 0);
  const gross = Number(row.amountGross ?? 0);
  const hasAmount = c > 0 || net > 0 || gross > 0;
  if (!hasAmount) return false;

  return true;
}

export function isSyncedMirrorDocumentSource(source: unknown): boolean {
  return source === JOB_MEDIA_DOCUMENT_SOURCE || source === JOB_EXPENSE_DOCUMENT_SOURCE;
}
