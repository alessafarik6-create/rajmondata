import type { BankTransactionDoc } from "@/lib/bank/types";

export type BankTransactionFilter = {
  dateFrom?: string | null;
  dateTo?: string | null;
  accountId?: string | null;
  direction?: "incoming" | "outgoing" | null;
  matchState?: "matched" | "unmatched" | "review" | null;
  amountMin?: number | null;
  amountMax?: number | null;
  variableSymbol?: string | null;
  counterparty?: string | null;
  q?: string | null;
};

export function bankTransactionMatchesFilter(
  row: BankTransactionDoc & { id: string },
  f: BankTransactionFilter
): boolean {
  if (f.accountId && row.accountId !== f.accountId) return false;
  if (f.direction && row.direction !== f.direction) return false;

  if (f.matchState === "matched") {
    const txnAbs = Math.abs(Number(row.amount));
    const matched = Number(row.matchedAmountTotal ?? 0);
    const fully =
      row.classification === "matched" ||
      row.matchStatus === "matched" ||
      (matched > 0 && matched >= txnAbs - 0.009);
    if (!fully) return false;
  }
  if (f.matchState === "unmatched") {
    const partial = Number(row.matchedAmountTotal ?? 0) > 0;
    if (row.classification === "matched" || partial) return false;
    if (row.matchStatus === "review") return false;
    if (["internal_transfer", "ignored", "expense", "other_income"].includes(row.classification)) {
      return false;
    }
  }

  if (f.matchState === "review") {
    const matched = Number(row.matchedAmountTotal ?? 0);
    const txnAbs = Math.abs(Number(row.amount));
    const isPartial = matched > 0 && matched < txnAbs - 0.009;
    const isReviewFlag = row.matchStatus === "review";
    if (!isPartial && !isReviewFlag) return false;
  }

  const bd = String(row.bookingDate ?? "");
  if (f.dateFrom && bd < f.dateFrom) return false;
  if (f.dateTo && bd > f.dateTo) return false;

  const absAmt = Math.abs(Number(row.amount));
  if (f.amountMin != null && absAmt < f.amountMin) return false;
  if (f.amountMax != null && absAmt > f.amountMax) return false;

  if (f.variableSymbol) {
    const vs = String(row.variableSymbol ?? "").replace(/\s/g, "");
    const needle = f.variableSymbol.replace(/\s/g, "");
    if (!vs.includes(needle)) return false;
  }

  if (f.counterparty) {
    const cp = String(row.counterpartyName ?? "").toLowerCase();
    if (!cp.includes(f.counterparty.toLowerCase())) return false;
  }

  if (f.q) {
    const hay = [
      row.counterpartyName,
      row.message,
      row.reference,
      row.variableSymbol,
      row.counterpartyAccount,
    ]
      .map((x) => String(x ?? "").toLowerCase())
      .join(" ");
    if (!hay.includes(f.q.toLowerCase())) return false;
  }

  return true;
}

export function parseBankTransactionFilterFromSearchParams(
  sp: URLSearchParams
): BankTransactionFilter {
  const num = (k: string) => {
    const v = sp.get(k);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    dateFrom: sp.get("dateFrom"),
    dateTo: sp.get("dateTo"),
    accountId: sp.get("accountId"),
    direction: (sp.get("direction") as "incoming" | "outgoing") || null,
    matchState: (sp.get("matchState") as "matched" | "unmatched" | "review") || null,
    amountMin: num("amountMin"),
    amountMax: num("amountMax"),
    variableSymbol: sp.get("variableSymbol"),
    counterparty: sp.get("counterparty"),
    q: sp.get("q"),
  };
}

export function bankDatePresetRange(
  preset: string,
  tzToday: string
): { dateFrom: string; dateTo: string } | null {
  const [y, m, d] = tzToday.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (dt: Date) => dt.toISOString().split("T")[0];

  if (preset === "today") return { dateFrom: tzToday, dateTo: tzToday };
  if (preset === "week") {
    const dt = new Date(Date.UTC(y, m - 1, d));
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() - (day - 1));
    return { dateFrom: iso(dt), dateTo: tzToday };
  }
  if (preset === "month") {
    return { dateFrom: `${y}-${pad(m)}-01`, dateTo: tzToday };
  }
  if (preset === "prev_month") {
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    return {
      dateFrom: `${py}-${pad(pm)}-01`,
      dateTo: `${py}-${pad(pm)}-${pad(lastDay)}`,
    };
  }
  if (preset === "last30") {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 30);
    return { dateFrom: iso(dt), dateTo: tzToday };
  }
  return null;
}
