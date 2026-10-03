import type { Firestore } from "firebase-admin/firestore";

export const BANK_CONNECTIONS_SUB = "bankConnections";
export const BANK_ACCOUNTS_SUB = "bankAccounts";
export const BANK_TRANSACTIONS_SUB = "bankTransactions";
export const BANK_MATCHES_SUB = "bankTransactionMatches";

export function bankConnectionsCol(db: Firestore, organizationId: string) {
  return db.collection("companies").doc(organizationId).collection(BANK_CONNECTIONS_SUB);
}

export function bankAccountsCol(db: Firestore, organizationId: string) {
  return db.collection("companies").doc(organizationId).collection(BANK_ACCOUNTS_SUB);
}

export function bankTransactionsCol(db: Firestore, organizationId: string) {
  return db.collection("companies").doc(organizationId).collection(BANK_TRANSACTIONS_SUB);
}

export function bankMatchesCol(db: Firestore, organizationId: string) {
  return db.collection("companies").doc(organizationId).collection(BANK_MATCHES_SUB);
}
