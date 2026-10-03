import crypto from "node:crypto";
import { roundMoney2 } from "@/lib/vat-calculations";

export type BankTransactionIdentityInput = {
  organizationId: string;
  accountId: string;
  externalTransactionId?: string | null;
  bookingDate: string;
  valueDate?: string | null;
  amount: number;
  currency: string;
  variableSymbol?: string | null;
  counterpartyAccount?: string | null;
  reference?: string | null;
  message?: string | null;
};

export function bankTransactionRawHash(input: BankTransactionIdentityInput): string {
  const parts = [
    input.organizationId,
    input.accountId,
    input.bookingDate,
    String(input.valueDate ?? ""),
    String(roundMoney2(input.amount)),
    String(input.currency ?? "").toUpperCase(),
    String(input.variableSymbol ?? "").trim(),
    String(input.counterpartyAccount ?? "").trim(),
    String(input.reference ?? "").trim(),
    String(input.message ?? "").trim().slice(0, 200),
  ];
  return crypto.createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

/** Stabilní ID dokumentu ve Firestore (idempotentní import). */
export function resolveBankTransactionDocId(input: BankTransactionIdentityInput): {
  externalTransactionId: string;
  rawHash: string;
} {
  const rawHash = bankTransactionRawHash(input);
  const ext = String(input.externalTransactionId ?? "").trim();
  if (ext) {
    const safe = ext.replace(/[/\\#?]/g, "_").slice(0, 120);
    return { externalTransactionId: safe, rawHash };
  }
  return { externalTransactionId: `hash_${rawHash.slice(0, 32)}`, rawHash };
}
