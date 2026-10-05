import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  bankAccountsCol,
  bankConnectionsCol,
  bankTransactionsCol,
} from "@/lib/bank/collections";
import { getRaiffeisenClientForOrg, setBankConnectionStatus } from "@/lib/bank/connection-store";
import { rbFetchAccounts, rbFetchTransactions } from "@/lib/bank/raiffeisen-client";
import { RbPremiumApiError } from "@/lib/bank/rb-premium-errors";
import { resolveBankTransactionDocId } from "@/lib/bank/transaction-id";
import type { BankTransactionDirection } from "@/lib/bank/types";
import { writeBankAuditLog } from "@/lib/bank/audit";
import { roundMoney2 } from "@/lib/vat-calculations";
import { pickAutoMatch, suggestBankTransactionMatches } from "@/lib/bank/matching";
import { applyBankTransactionMatch } from "@/lib/bank/apply-match";

const DEFAULT_HISTORY_DAYS = 90;

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

    try {
      const accounts = await rbFetchAccounts(loaded.cfg);
      const connRef = bankConnectionsCol(db, organizationId).doc(loaded.connectionId);

      for (const acc of accounts) {
        if (!acc.externalAccountId) continue;
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
            balance: acc.balance ?? null,
            availableBalance: acc.availableBalance ?? null,
            isActive: prev.exists ? (prev.data()?.isActive !== false) : true,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        const dateFrom = isoDaysAgo(DEFAULT_HISTORY_DAYS);
        const dateTo = new Date().toISOString().split("T")[0];
        let txns: Awaited<ReturnType<typeof rbFetchTransactions>> = [];
        try {
          txns = await rbFetchTransactions(loaded.cfg, acc, { dateFrom, dateTo });
        } catch (accErr) {
          if (accErr instanceof RbPremiumApiError) throw accErr;
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

      const todayIso = new Date().toISOString().split("T")[0];
      const invSnap = await db
        .collection("companies")
        .doc(organizationId)
        .collection("invoices")
        .limit(200)
        .get();
      const issuedInvoices = invSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Record<string, unknown>),
      }));
      const docSnap = await db
        .collection("companies")
        .doc(organizationId)
        .collection("documents")
        .limit(200)
        .get();
      const receivedDocuments = docSnap.docs
        .filter((d) => {
          const t = String(d.data().type ?? "").toLowerCase();
          const k = String(d.data().documentKind ?? "").toLowerCase();
          return t === "received" || k === "prijate";
        })
        .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

      const recentTxSnap = await bankTransactionsCol(db, organizationId)
        .where("classification", "==", "unmatched")
        .orderBy("bookingDate", "desc")
        .limit(50)
        .get()
        .catch(() => null);

      if (recentTxSnap) {
        for (const tDoc of recentTxSnap.docs) {
          const t = tDoc.data();
          if (Number(t.matchedAmountTotal ?? 0) > 0) continue;
          const suggestions = suggestBankTransactionMatches(
            {
              direction: t.direction as "incoming" | "outgoing",
              amount: Number(t.amount),
              currency: String(t.currency ?? "CZK"),
              variableSymbol: t.variableSymbol as string | null,
              counterpartyName: t.counterpartyName as string | null,
              counterpartyAccount: t.counterpartyAccount as string | null,
              bookingDate: String(t.bookingDate),
            },
            { todayIso, issuedInvoices, receivedDocuments }
          );
          const auto = pickAutoMatch(suggestions);
          if (!auto) continue;
          try {
            const amt = Math.abs(roundMoney2(Number(t.amount)));
            await applyBankTransactionMatch(db, {
              organizationId,
              transactionId: tDoc.id,
              userId,
              matchedAmount: amt,
              matchType: "auto",
              confidence: auto.confidence,
              issuedInvoiceId: auto.targetKind === "issued_invoice" ? auto.targetId : null,
              receivedDocumentId: auto.targetKind === "received_document" ? auto.targetId : null,
            });
          } catch {
            /* nízká confidence / kolize — pouze návrh v UI */
          }
        }
      }

      const lastSyncAt = new Date().toISOString();
      await connRef.set(
        {
          status: "connected",
          lastSyncAt,
          lastSyncError: null,
          lastSyncStats: { accounts: accounts.length, imported, updated },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await writeBankAuditLog(db, {
        organizationId,
        userId,
        action: "BANK_SYNC_FINISHED",
        metadata: { accounts: accounts.length, imported, updated },
      });

      return { accounts: accounts.length, imported, updated, lastSyncAt };
    } catch (e) {
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
