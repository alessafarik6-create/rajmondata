import { summarizeLedgerByCurrency } from "@/lib/documents/receivables-payables-pdf";
import type { ReceivablesExportRow } from "@/lib/documents/receivables-payables-export";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const rows: ReceivablesExportRow[] = [
  {
    kind: "receivable",
    number: "FV1",
    partner: "A",
    ico: "",
    issuedDate: "2026-01-01",
    dueDate: "2026-02-01",
    totalAmount: 1000,
    paidAmount: 400,
    remainingAmount: 600,
    statusLabel: "Částečně",
    overdueDays: 5,
    jobLabel: "",
    currency: "CZK",
  },
  {
    kind: "payable",
    number: "P1",
    partner: "B",
    ico: "",
    issuedDate: "2026-01-01",
    dueDate: "2026-02-01",
    totalAmount: 500,
    paidAmount: 500,
    remainingAmount: 0,
    statusLabel: "Uhrazeno",
    overdueDays: 0,
    jobLabel: "",
    currency: "CZK",
  },
];

const sum = summarizeLedgerByCurrency(rows);
assert(sum.length === 1, "one currency");
assert(sum[0]!.receivables.remaining === 600, "recv remaining");
assert(sum[0]!.payables.paid === 500, "pay paid");
assert(sum[0]!.receivables.overdueRemaining === 600, "overdue recv");

console.log("ok receivables-pdf summary");
