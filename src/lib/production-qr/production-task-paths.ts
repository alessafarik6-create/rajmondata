import type { Firestore } from "firebase-admin/firestore";
import { randomBytes } from "crypto";

export function productionTasksCol(db: Firestore, companyId: string, jobId: string) {
  return db.collection("companies").doc(companyId).collection("jobs").doc(jobId).collection("productionTasks");
}

export function productionQrTokensCol(db: Firestore, companyId: string) {
  return db.collection("companies").doc(companyId).collection("productionQrTokens");
}

export function productionTimeEntriesCol(db: Firestore, companyId: string) {
  return db.collection("companies").doc(companyId).collection("productionTimeEntries");
}

export function productionTimeEntryAuditsCol(db: Firestore, companyId: string) {
  return db.collection("companies").doc(companyId).collection("productionTimeEntryAudits");
}

/** Náhodný veřejný token (URL-safe, bez citlivých dat). */
export function generateProductionPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

export function buildProductionScanPath(token: string): string {
  return `/work/scan/${encodeURIComponent(token)}`;
}

export function resolveProductionScanUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}${buildProductionScanPath(token)}`;
}
