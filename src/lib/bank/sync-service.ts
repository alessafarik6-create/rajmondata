import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  bankAccountsCol,
  bankConnectionsCol,
  bankTransactionsCol,
} from "@/lib/bank/collections";
import { getRaiffeisenClientForOrg, setBankConnectionStatus } from "@/lib/bank/connection-store";
import {
  rbFetchAccountBalance,
  rbFetchAccounts,
  rbFetchTransactions,
} from "@/lib/bank/raiffeisen-client";
import { RbPremiumApiError } from "@/lib/bank/rb-premium-errors";
import { BankSyncPartialError } from "@/lib/bank/bank-sync-errors";
import { resolveBankTransactionDocId } from "@/lib/bank/transaction-id";
import type { BankTransactionDirection } from "@/lib/bank/types";
import { writeBankAuditLog } from "@/lib/bank/audit";
import { roundMoney2 } from "@/lib/vat-calculations";
import { refreshSuggestedMatchesForOrganization } from "@/lib/bank/suggested-matches-service";

/** RB limit: from max 90 dní — sync používá 30 dní (DT01 při překročení). */
const DEFAULT_HISTORY_DAYS = 30;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

function directionFromAmount(amount: number): BankTransactionDirection {
  return amount >= 0 ? "incoming" : "outgoing";
}

export type BankSyncResult = {
  accounts: number;
  imported: number;
  updated: number;
  lastSyncAt: string;
  accountsSuccess?: boolean;
  transactionsSuccess?: boolean;
};

let syncLocks = new Map<string, Promise<BankSyncResult>>();

export async function syncBankForOrganization(
  db: Firestore,
  organizationId: string,
  userId: string
): Promise<BankSyncResult> {
  const key = organizationId;
  const running = syncLocks.get(key);
  if (running) return running;

  const job = (async () => {
    await writeBankAuditLog(db, {
      organizationId,
      userId,
      action: "BANK_SYNC_STARTED",
    });

    const loaded = await getRaiffeisenClientForOrg(db, organizationId);
    if ("error" in loaded) {
      await setBankConnectionStatus(db, organizationId, "error", loaded.error);
      throw new Error(loaded.error);
    }

    await setBankConnectionStatus(db, organizationId, "syncing", null);

    let imported = 0;
    let updated = 0;
    let accountsSaved = 0;
    let transactionsSuccess = true;

    try {
      console.info("[RB SYNC] accounts start");
      let accounts: Awaited<ReturnType<typeof rbFetchAccounts>>;
      try {
        accounts = await rbFetchAccounts(loaded.cfg);
      } catch (accErr) {
        console.error("[RB SYNC] accounts failed");
        throw accErr;
      }
      console.info("[RB SYNC] accounts success", { count: accounts.length });
      console.info("[RB SYNC] accounts count", accounts.length);

      const connRef = bankConnectionsCol(db, organizationId).doc(loaded.connectionId);

      for (const acc of accounts) {
        if (!acc.externalAccountId) continue;

        let balance = acc.balance ?? null;
        let availableBalance = acc.availableBalance ?? null;
        if (acc.rbAccountNumber) {
          try {
            const bal = await rbFetchAccountBalance(loaded.cfg, acc);
            balance = bal.balance;
            availableBalance = bal.availableBalance ?? bal.balance;
          } catch (balErr) {
            console.warn("[RB SYNC] balance fetch failed", {
              suffix: String(acc.rbAccountNumber).slice(-4),
              message: balErr instanceof Error ? balErr.message : String(balErr),
            });
          }
        }

        const accRef = bankAccountsCol(db, organizationId).doc(acc.externalAccountId);
        const prev = await accRef.get();
        await accRef.set(
          {
            organizationId,
            connectionId: loaded.connectionId,
            externalAccountId: acc.externalAccountId,
            accountNumber: acc.accountNumber ?? null,
            iban: acc.iban ?? null,
            currency: acc.currency,
            name: acc.name ?? null,
            balance,
            availableBalance,
            isActive: prev.exists ? (prev.data()?.isActive !== false) : true,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        accountsSaved += 1;

        if (!acc.rbAccountNumber) {
          console.warn("[RB SYNC] skip transactions — missing rbAccountNumber", {
            externalAccountIdSuffix: String(acc.externalAccountId ?? "").slice(-4),
          });
          continue;
        }

        const dateFrom = isoDaysAgo(DEFAULT_HISTORY_DAYS);
        const dateTo = new Date().toISOString().split("T")[0];
        console.info("[RB SYNC] transactions start", {
          externalAccountIdSuffix: String(acc.externalAccountId ?? "").slice(-4),
        });
        let txns: Awaited<ReturnType<typeof rbFetchTransactions>> = [];
        try {
          txns = await rbFetchTransactions(loaded.cfg, acc, { dateFrom, dateTo });
          console.info("[RB SYNC] transactions success", { count: txns.length });
        } catch (accErr) {
          console.error("[RB SYNC] transactions failed");
          transactionsSuccess = false;
          if (accErr instanceof RbPremiumApiError) {
            const partial: BankSyncResult = {
              accounts: accountsSaved,
              imported,
              updated,
              lastSyncAt: new Date().toISOString(),
              accountsSuccess: accountsSaved > 0,
              transactionsSuccess: false,
            };
            await connRef.set(
              {
                status: "connected",
                lastSyncAt: partial.lastSyncAt,
                lastSyncError: accErr.display.slice(0, 500),
                lastSyncStats: {
                  accounts: accountsSaved,
                  imported,
                  updated,
                  partial: true,
                },
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            throw new BankSyncPartialError(partial, accErr);
          }
          console.error("[RB SYNC] transactions failed for account", {
            externalAccountId: acc.externalAccountId,
            message: accErr instanceof Error ? accErr.message : String(accErr),
          });
          continue;
        }

        for (const t of txns) {
          const amount = roundMoney2(Number(t.amount));
          if (!Number.isFinite(amount) || amount === 0) continue;
          const bookingDate = String(t.bookingDate ?? "").slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) continue;

          const ids = resolveBankTransactionDocId({
            organizationId,
            accountId: acc.externalAccountId,
            externalTransactionId: t.externalTransactionId,
            bookingDate,
            valueDate: t.valueDate,
            amount,
            currency: t.currency ?? acc.currency,
            variableSymbol: t.variableSymbol,
            counterpartyAccount: t.counterpartyAccount,
            reference: t.reference,
            message: t.message,
          });

          const txnRef = bankTransactionsCol(db, organizationId).doc(ids.externalTransactionId);
          const exists = await txnRef.get();
          const payload = {
            organizationId,
            accountId: acc.externalAccountId,
            externalTransactionId: ids.externalTransactionId,
            rawHash: ids.rawHash,
            bookingDate,
            valueDate: t.valueDate ?? null,
            amount,
            currency: String(t.currency ?? acc.currency).toUpperCase(),
            direction: directionFromAmount(amount),
            counterpartyName: t.counterpartyName ?? null,
            counterpartyAccount: t.counterpartyAccount ?? null,
            variableSymbol: t.variableSymbol ?? null,
            constantSymbol: t.constantSymbol ?? null,
            specificSymbol: t.specificSymbol ?? null,
            message: t.message ?? null,
            reference: t.reference ?? null,
            updatedAt: FieldValue.serverTimestamp(),
          };

          if (!exists.exists) {
            await txnRef.set({
              ...payload,
              classification: "unmatched",
              matchedAmountTotal: 0,
              createdAt: FieldValue.serverTimestamp(),
            });
            imported += 1;
          } else {
            const prevHash = String(exists.data()?.rawHash ?? "");
            if (prevHash !== ids.rawHash) {
              await txnRef.set(payload, { merge: true });
              updated += 1;
            }
          }
        }
      }

      await refreshSuggestedMatchesForOrganization(db, organizationId, 80);

      const lastSyncAt = new Date().toISOString();
      await connRef.set(
        {
          status: "connected",
          lastSyncAt,
          lastSyncError: null,
          lastSyncStats: { accounts: accountsSaved, imported, updated },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await writeBankAuditLog(db, {
        organizationId,
        userId,
        action: "BANK_SYNC_FINISHED",
        metadata: { accounts: accountsSaved, imported, updated },
      });

      return {
        accounts: accountsSaved,
        imported,
        updated,
        lastSyncAt,
        accountsSuccess: accountsSaved > 0,
        transactionsSuccess,
      };
    } catch (e) {
      if (e instanceof BankSyncPartialError) throw e;
      const msg =
        e instanceof RbPremiumApiError
          ? e.display.slice(0, 500)
          : e instanceof Error
            ? e.message
            : "Synchronizace selhala.";
      await setBankConnectionStatus(db, organizationId, "error", msg);
      if (e instanceof RbPremiumApiError) throw e;
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      syncLocks.delete(key);
    }
  })();

  syncLocks.set(key, job);
  return job;
}
