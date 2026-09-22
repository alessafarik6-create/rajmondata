/**
 * Přepočet částek rozdělení dokladu (S DPH / bez DPH) podle skutečné sazby dokladu.
 */

import {
  allocationBasisGrossCzk,
  type JobCostAllocationMode,
  type JobCostAllocationRow,
} from "@/lib/company-document-job-allocations";
import {
  companyDocumentExpenseAmounts,
  type CompanyDocumentExpenseReconcileBefore,
} from "@/lib/document-job-expense-sync";
import { roundMoney2 } from "@/lib/vat-calculations";

export type AllocationAmountInputBasis = "gross" | "net";

export type DocumentAllocationTotalsCzk = {
  net: number;
  vat: number;
  gross: number;
  vatRatePercent: number;
};

export function documentAllocationTotalsCzk(
  doc: CompanyDocumentExpenseReconcileBefore | Record<string, unknown>
): DocumentAllocationTotalsCzk {
  const amounts = companyDocumentExpenseAmounts(
    doc as CompanyDocumentExpenseReconcileBefore
  );
  const gross = roundMoney2(
    allocationBasisGrossCzk(doc as Record<string, unknown>) || amounts.amountGross
  );
  let net = roundMoney2(amounts.amountNet);
  let vat = roundMoney2(amounts.vatAmount);
  const rate = amounts.vatRatePercent;
  if (gross > 0 && net <= 0 && rate > 0) {
    net = roundMoney2(gross / (1 + rate / 100));
    vat = roundMoney2(gross - net);
  } else if (gross > 0 && net <= 0) {
    net = gross;
    vat = 0;
  } else if (gross <= 0 && net > 0) {
    vat = roundMoney2((net * rate) / 100);
    return { net, vat, gross: roundMoney2(net + vat), vatRatePercent: rate };
  }
  if (gross <= 0 && net > 0) {
    return {
      net,
      vat,
      gross: roundMoney2(net + vat),
      vatRatePercent: rate,
    };
  }
  return {
    net: net > 0 ? net : gross,
    vat,
    gross: gross > 0 ? gross : roundMoney2(net + vat),
    vatRatePercent: rate,
  };
}

/** Uživatelský vstup → uložená hrubá částka (CZK) pro alokaci. */
export function allocationInputToGrossCzk(
  input: number,
  basis: AllocationAmountInputBasis,
  totals: DocumentAllocationTotalsCzk
): number {
  const v = roundMoney2(input);
  if (v <= 0) return 0;
  if (basis === "gross") return v;
  const rate = totals.vatRatePercent;
  if (!Number.isFinite(rate) || rate <= 0) return v;
  return roundMoney2(v * (1 + rate / 100));
}

/** Hrubá alokace → net/vat/gross pro řádek. */
export function sliceTotalsFromGrossCzk(
  grossSlice: number,
  docTotals: DocumentAllocationTotalsCzk
): { net: number; vat: number; gross: number } {
  const g = roundMoney2(grossSlice);
  if (g <= 0) return { net: 0, vat: 0, gross: 0 };
  const rate = docTotals.vatRatePercent;
  if (!Number.isFinite(rate) || rate <= 0) {
    return { net: g, vat: 0, gross: g };
  }
  const net = roundMoney2(g / (1 + rate / 100));
  const vat = roundMoney2(g - net);
  return { net, vat, gross: g };
}

/** Zobrazení uložené hrubé částky v zvoleném režimu. */
export function grossCzkToDisplayInput(
  grossCzk: number,
  basis: AllocationAmountInputBasis,
  totals: DocumentAllocationTotalsCzk
): number {
  const g = roundMoney2(grossCzk);
  if (basis === "gross") return g;
  const rate = totals.vatRatePercent;
  if (!Number.isFinite(rate) || rate <= 0) return g;
  return roundMoney2(g / (1 + rate / 100));
}

export type AllocationFormRowInput = {
  id: string;
  kind: "job" | "overhead";
  jobId: string;
  amount: string;
  percent: string;
  note: string;
  linkedExpenseId?: string | null;
};

/** Formulářové řádky → doménové alokace (amount vždy hrubá CZK). */
export function allocationFormRowsToDomain(params: {
  mode: JobCostAllocationMode;
  inputBasis: AllocationAmountInputBasis;
  totals: DocumentAllocationTotalsCzk;
  rows: AllocationFormRowInput[];
}): JobCostAllocationRow[] {
  const { mode, inputBasis, totals, rows } = params;
  return rows.map((r) => {
    let amount: number | null = null;
    let percent: number | null = null;
    if (mode === "amount") {
      if (r.amount.trim() === "") amount = null;
      else {
        const raw = roundMoney2(Number(String(r.amount).replace(",", ".")));
        amount = allocationInputToGrossCzk(raw, inputBasis, totals);
      }
    } else if (r.percent.trim() === "") percent = null;
    else {
      percent = Number(String(r.percent).replace(",", "."));
    }
    return {
      id: r.id,
      kind: r.kind,
      jobId: r.kind === "job" && r.jobId.trim() ? r.jobId.trim() : null,
      amount,
      percent,
      note: r.note.trim() || null,
      linkedExpenseId: r.linkedExpenseId?.trim() || null,
    };
  });
}

/** Načtení doménových řádků do formuláře (amount režim). */
export function domainRowsToAllocationForm(
  rows: JobCostAllocationRow[],
  mode: JobCostAllocationMode,
  inputBasis: AllocationAmountInputBasis,
  totals: DocumentAllocationTotalsCzk
): AllocationFormRowInput[] {
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    jobId: r.jobId?.trim() ?? "",
    amount:
      mode === "amount" && r.amount != null && Number.isFinite(r.amount)
        ? String(grossCzkToDisplayInput(r.amount, inputBasis, totals))
        : "",
    percent:
      r.percent != null && Number.isFinite(r.percent) ? String(r.percent) : "",
    note: r.note?.trim() ?? "",
    linkedExpenseId: r.linkedExpenseId ?? null,
  }));
}

export function documentJobCostAllocationAmountBasis(
  doc: Record<string, unknown>
): AllocationAmountInputBasis {
  const b = doc.jobCostAllocationAmountBasis;
  return b === "net" ? "net" : "gross";
}

/** Přepnutí S DPH ↔ bez DPH bez změny uložené hrubé alokace. */
export function switchAllocationFormBasis(
  rows: AllocationFormRowInput[],
  from: AllocationAmountInputBasis,
  to: AllocationAmountInputBasis,
  totals: DocumentAllocationTotalsCzk,
  mode: JobCostAllocationMode
): AllocationFormRowInput[] {
  if (mode !== "amount" || from === to) return rows;
  const domain = allocationFormRowsToDomain({
    mode,
    inputBasis: from,
    totals,
    rows,
  });
  return domainRowsToAllocationForm(domain, mode, to, totals);
}
