import type { RbPremiumApiError } from "@/lib/bank/rb-premium-errors";
import { rbPremiumSyncUserMessage } from "@/lib/bank/rb-premium-errors";

export type BankSyncPartialResult = {
  accounts: number;
  imported: number;
  updated: number;
  lastSyncAt: string;
};

/** Účty uloženy, transakce selhaly u RB. */
export class BankSyncPartialError extends Error {
  readonly result: BankSyncPartialResult;
  readonly rbError: RbPremiumApiError;
  readonly userMessage: string;

  constructor(result: BankSyncPartialResult, rbError: RbPremiumApiError) {
    const userMessage = rbPremiumSyncUserMessage(rbError, true);
    super(userMessage);
    this.name = "BankSyncPartialError";
    this.result = result;
    this.rbError = rbError;
    this.userMessage = userMessage;
  }
}
