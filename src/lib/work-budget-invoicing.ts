import { roundMoney2 } from "@/lib/vat-calculations";
import {
  computePortalManualInvoiceTotals,
  type PortalManualFormItem,
} from "@/lib/portal-manual-invoice";
import type {
  JobWorkBudgetItemDoc,
  WorkBudgetInvoiceItemLink,
} from "@/lib/work-budget-types";
import {
  isApprovedExtraWorkItem,
  isExtraWorkItem,
  isNormalBudgetItem,
} from "@/lib/work-budget-types";

export type WorkBudgetBillingScope =
  | "base"
  | "extra_only"
  | "base_and_extra"
  | "manual";

export type { WorkBudgetInvoiceItemLink };

export type WorkBudgetInvoicingStatus = "none" | "partial" | "full";

export type WorkBudgetBillSlice = {
  item: JobWorkBudgetItemDoc;
  /** Částka z této položky na aktuální faktuře (bez DPH). */
  billNet: number;
  billGross: number;
  billQuantity: number;
};

const EPS = 0.009;

export function sumInvoicedFromLinks(links: WorkBudgetInvoiceItemLink[]): {
  net: number;
  gross: number;
} {
  let net = 0;
  let gross = 0;
  for (const l of links) {
    net += l.amountNet;
    gross += l.amountGross;
  }
  return { net: roundMoney2(net), gross: roundMoney2(gross) };
}

export function getItemInvoicedTotals(item: JobWorkBudgetItemDoc): {
  net: number;
  gross: number;
} {
  const links = item.invoiceItemLinks ?? [];
  if (links.length > 0) {
    return sumInvoicedFromLinks(links);
  }
  if (typeof item.invoicedAmountNet === "number" || typeof item.invoicedAmountGross === "number") {
    return {
      net: roundMoney2(Number(item.invoicedAmountNet) || 0),
      gross: roundMoney2(Number(item.invoicedAmountGross) || 0),
    };
  }
  if (item.invoiced === true) {
    return { net: item.amountNet, gross: item.amountGross };
  }
  return { net: 0, gross: 0 };
}

export function remainingToInvoice(item: JobWorkBudgetItemDoc): {
  net: number;
  gross: number;
  quantity: number;
} {
  const invoiced = getItemInvoicedTotals(item);
  const net = roundMoney2(Math.max(0, item.amountNet - invoiced.net));
  const gross = roundMoney2(Math.max(0, item.amountGross - invoiced.gross));
  const qtyTotal = Math.max(0, Number(item.quantity) || 0);
  const ratio = item.amountNet > EPS ? net / item.amountNet : net <= EPS ? 0 : 1;
  const quantity = roundMoney2(qtyTotal * Math.min(1, Math.max(0, ratio)));
  return { net, gross, quantity: quantity || (gross > EPS ? qtyTotal : 0) };
}

export function workBudgetItemInvoicingStatus(
  item: JobWorkBudgetItemDoc
): WorkBudgetInvoicingStatus {
  const rem = remainingToInvoice(item);
  const inv = getItemInvoicedTotals(item);
  if (inv.gross <= EPS) return "none";
  if (rem.gross <= EPS) return "full";
  return "partial";
}

export function primaryInvoiceLinkId(item: JobWorkBudgetItemDoc): string | null {
  if (item.linkedInvoiceId) return item.linkedInvoiceId;
  const links = item.invoiceItemLinks ?? [];
  return links.length ? links[links.length - 1]!.invoiceId : null;
}

/** Položka je k dispozici pro novou fakturu (nebo pro regeneraci dané faktury). */
export function workBudgetItemHasBillableRemainder(
  row: JobWorkBudgetItemDoc,
  regenerateInvoiceId?: string | null
): boolean {
  if (!row.done || row.amountGross <= EPS) return false;
  if (isExtraWorkItem(row) && !isApprovedExtraWorkItem(row)) return false;
  const reg = String(regenerateInvoiceId ?? "").trim();
  if (reg && row.invoiceItemLinks?.some((l) => l.invoiceId === reg)) return true;
  if (reg && row.linkedInvoiceId === reg) return true;
  return remainingToInvoice(row).gross > EPS;
}

export function filterItemsByBillingScope(
  items: JobWorkBudgetItemDoc[],
  scope: WorkBudgetBillingScope,
  selectedItemIds?: string[]
): JobWorkBudgetItemDoc[] {
  const idSet =
    scope === "manual" && selectedItemIds?.length
      ? new Set(selectedItemIds.map((id) => String(id).trim()).filter(Boolean))
      : null;

  return items.filter((row) => {
    if (idSet && !idSet.has(row.id)) return false;
    if (scope === "base") return isNormalBudgetItem(row);
    if (scope === "extra_only") return isApprovedExtraWorkItem(row);
    if (scope === "base_and_extra") {
      return isNormalBudgetItem(row) || isApprovedExtraWorkItem(row);
    }
    return true;
  });
}

export function buildBillSlicesForInvoice(
  items: JobWorkBudgetItemDoc[],
  regenerateInvoiceId?: string | null,
  partialNetByItemId?: Record<string, number>
): WorkBudgetBillSlice[] {
  const reg = String(regenerateInvoiceId ?? "").trim() || null;
  const slices: WorkBudgetBillSlice[] = [];
  for (const item of items) {
    if (!workBudgetItemHasBillableRemainder(item, reg)) continue;
    const rem = remainingToInvoice(item);
    let billNet = rem.net;
    let billGross = rem.gross;
    let billQuantity = rem.quantity;
    const cap = partialNetByItemId?.[item.id];
    if (typeof cap === "number" && cap > 0 && cap < billNet - EPS) {
      billNet = roundMoney2(cap);
      const ratio = item.amountNet > EPS ? billNet / item.amountNet : 0;
      billGross = roundMoney2(item.amountGross * ratio);
      billQuantity = roundMoney2((Number(item.quantity) || 0) * ratio);
    }
    if (billGross <= EPS) continue;
    slices.push({ item, billNet, billGross, billQuantity });
  }
  return slices;
}

export function assertWorkBudgetInvoiceSelectionValid(params: {
  slices: WorkBudgetBillSlice[];
  regenerateInvoiceId?: string | null;
}): void {
  for (const s of params.slices) {
    const rem = remainingToInvoice(s.item);
    if (s.billGross > rem.gross + EPS) {
      throw new Error(
        `Položka „${s.item.title}“ je již částečně nebo úplně vyfakturována (zbývá ${rem.gross.toLocaleString("cs-CZ")} Kč s DPH).`
      );
    }
    if (s.billNet <= 0 || s.billGross <= 0) {
      throw new Error(`Položka „${s.item.title}“ nemá fakturovatelnou částku.`);
    }
  }
  if (params.slices.length === 0) {
    throw new Error("Žádné položky k fakturaci pro zvolený rozsah.");
  }
}

export function mergeInvoiceItemLink(
  existing: WorkBudgetInvoiceItemLink[],
  invoiceId: string,
  add: { amountNet: number; amountGross: number; quantity: number; invoicedAt: string }
): WorkBudgetInvoiceItemLink[] {
  const list = [...existing];
  const idx = list.findIndex((l) => l.invoiceId === invoiceId);
  if (idx >= 0) {
    list[idx] = {
      invoiceId,
      amountNet: roundMoney2(add.amountNet),
      amountGross: roundMoney2(add.amountGross),
      quantity: add.quantity,
      invoicedAt: add.invoicedAt,
    };
  } else {
    list.push({
      invoiceId,
      amountNet: roundMoney2(add.amountNet),
      amountGross: roundMoney2(add.amountGross),
      quantity: add.quantity,
      invoicedAt: add.invoicedAt,
    });
  }
  return list;
}

export function removeInvoiceItemLink(
  existing: WorkBudgetInvoiceItemLink[],
  invoiceId: string
): WorkBudgetInvoiceItemLink[] {
  return existing.filter((l) => l.invoiceId !== invoiceId);
}

export type WorkBudgetInvoicingSummary = {
  base: { totalNet: number; invoicedNet: number; remainingNet: number };
  extra: { totalNet: number; invoicedNet: number; remainingNet: number };
  all: { totalNet: number; invoicedNet: number; remainingNet: number };
};

/** Mapování řádků faktury (id = workBudgetItemId) na bill slices pro sync vazeb. */
export function buildBillSlicesFromManualInvoiceLines(params: {
  budgetItems: JobWorkBudgetItemDoc[];
  invoiceId: string;
  lines: PortalManualFormItem[];
}): WorkBudgetBillSlice[] {
  const byId = new Map(params.budgetItems.map((row) => [row.id, row]));
  const slices: WorkBudgetBillSlice[] = [];
  for (const line of params.lines) {
    const budget = byId.get(line.id);
    if (!budget) continue;
    const lineTotals = computePortalManualInvoiceTotals([line]);
    if (lineTotals.amountGross <= EPS) continue;
    const billNet = lineTotals.amountNet;
    const billGross = lineTotals.amountGross;
    const billQuantity = Math.max(0, Number(line.quantity) || 0);
    const rem = remainingToInvoice(budget);
    const existing = (budget.invoiceItemLinks ?? []).find(
      (l) => l.invoiceId === params.invoiceId
    );
    const maxGross = roundMoney2(rem.gross + (existing?.amountGross ?? 0));
    if (billGross > maxGross + EPS) {
      throw new Error(
        `Položka „${budget.title}“ je již částečně nebo úplně vyfakturována (max. ${maxGross.toLocaleString("cs-CZ")} Kč s DPH na tomto dokladu).`
      );
    }
    slices.push({ item: budget, billNet, billGross, billQuantity });
  }
  return slices;
}

export function computeWorkBudgetInvoicingSummary(
  items: JobWorkBudgetItemDoc[]
): WorkBudgetInvoicingSummary {
  const sumGroup = (rows: JobWorkBudgetItemDoc[]) => {
    let totalNet = 0;
    let invoicedNet = 0;
    for (const row of rows) {
      if (!row.done) continue;
      if (isExtraWorkItem(row) && !isApprovedExtraWorkItem(row)) continue;
      totalNet += row.amountNet;
      invoicedNet += getItemInvoicedTotals(row).net;
    }
    totalNet = roundMoney2(totalNet);
    invoicedNet = roundMoney2(invoicedNet);
    return {
      totalNet,
      invoicedNet,
      remainingNet: roundMoney2(Math.max(0, totalNet - invoicedNet)),
    };
  };
  const baseRows = items.filter(isNormalBudgetItem);
  const extraRows = items.filter(isApprovedExtraWorkItem);
  const base = sumGroup(baseRows);
  const extra = sumGroup(extraRows);
  return {
    base,
    extra,
    all: {
      totalNet: roundMoney2(base.totalNet + extra.totalNet),
      invoicedNet: roundMoney2(base.invoicedNet + extra.invoicedNet),
      remainingNet: roundMoney2(base.remainingNet + extra.remainingNet),
    },
  };
}
