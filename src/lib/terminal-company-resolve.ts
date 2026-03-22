import { FieldPath } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  COMPANIES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
} from "@/lib/firestore-collections";
import { loadPublicTerminalConfig } from "@/lib/terminal-config-server";

async function organizationOrCompanyExists(
  db: Firestore,
  companyId: string
): Promise<boolean> {
  const org = await db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).get();
  if (org.exists) return true;
  const comp = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  return comp.exists;
}

/**
 * Jednotný výběr firmy pro veřejný terminál (bez Firebase Auth na klientovi).
 *
 * Pořadí:
 * 1) terminálOdkazy (stejná logika jako GET /api/terminal/config)
 * 2) TERMINAL_COMPANY_ID (volitelný ops fallback)
 * 3) config/terminal.companyId
 * 4) v dev / při TERMINAL_ALLOW_FIRST_COMPANY_FALLBACK — první dokument ve společnosti
 */
export async function resolveTerminalCompanyId(): Promise<string | null> {
  const db = getAdminFirestore();
  if (!db) return null;

  const fromLinks = await loadPublicTerminalConfig();
  if (fromLinks.success) {
    return fromLinks.companyId;
  }

  if (process.env.NODE_ENV === "development") {
    console.warn("[terminal-company] terminálOdkazy:", fromLinks.error);
  }

  const envId = process.env.TERMINAL_COMPANY_ID?.trim();
  if (envId) {
    if (await organizationOrCompanyExists(db, envId)) {
      console.log("Resolved companyId from TERMINAL_COMPANY_ID env", { companyId: envId });
      return envId;
    }
    console.error("[terminal-company] TERMINAL_COMPANY_ID neexistuje ve Firestore:", envId);
    return null;
  }

  const cfgSnap = await db.collection("config").doc("terminal").get();
  const cfgId =
    cfgSnap.exists && typeof cfgSnap.data()?.companyId === "string"
      ? (cfgSnap.data() as { companyId: string }).companyId.trim()
      : "";
  if (cfgId) {
    if (await organizationOrCompanyExists(db, cfgId)) {
      console.log("Resolved companyId from config/terminal", { companyId: cfgId });
      return cfgId;
    }
    console.error("[terminal-company] config/terminal.companyId neexistuje ve Firestore:", cfgId);
  }

  const allowFirstCompanyFallback =
    process.env.NODE_ENV !== "production" ||
    process.env.TERMINAL_ALLOW_FIRST_COMPANY_FALLBACK === "true";
  if (!allowFirstCompanyFallback) {
    console.error(
      "[terminal-company] Nastavte aktivní záznam v terminálOdkazy, případně TERMINAL_COMPANY_ID nebo config/terminal."
    );
    return null;
  }

  const q = await db.collection(ORGANIZATIONS_COLLECTION).orderBy(FieldPath.documentId()).limit(1).get();
  if (!q.empty) {
    console.warn(
      "[terminal-company] Používám první organizaci ze společnosti (vývoj / výslovný opt-in)."
    );
    return q.docs[0].id;
  }

  const q2 = await db.collection(COMPANIES_COLLECTION).orderBy(FieldPath.documentId()).limit(1).get();
  if (q2.empty) {
    console.error("[terminal-company] Ve Firestore není žádná firma.");
    return null;
  }
  console.warn(
    "[terminal-company] Používám první firmu z companies (vývoj / výslovný opt-in). Není vhodné pro produkci."
  );
  return q2.docs[0].id;
}

export async function getCompanyDisplayName(companyId: string): Promise<string> {
  const db = getAdminFirestore();
  if (!db) return "";
  const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).get();
  if (orgSnap.exists) {
    const d = orgSnap.data() as Record<string, unknown>;
    const cn = typeof d.companyName === "string" ? d.companyName.trim() : "";
    if (cn) return cn;
    const n = typeof d.name === "string" ? d.name.trim() : "";
    if (n) return n;
  }
  const compSnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  if (!compSnap.exists) return "";
  const d = compSnap.data() as Record<string, unknown>;
  const cn = typeof d.companyName === "string" ? d.companyName.trim() : "";
  if (cn) return cn;
  const n = typeof d.name === "string" ? d.name.trim() : "";
  return n || "";
}
