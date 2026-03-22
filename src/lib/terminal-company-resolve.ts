import { FieldPath } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";

/**
 * Jednotný výběr firmy pro veřejný terminál (bez Firebase Auth na klientovi).
 * Pořadí: TERMINAL_COMPANY_ID → config/terminal.companyId → první companies dokument.
 */
export async function resolveTerminalCompanyId(): Promise<string | null> {
  const db = getAdminFirestore();
  if (!db) return null;

  const envId = process.env.TERMINAL_COMPANY_ID?.trim();
  if (envId) {
    const snap = await db.collection("companies").doc(envId).get();
    if (snap.exists) return envId;
    console.error("[terminal-company] TERMINAL_COMPANY_ID neexistuje ve Firestore:", envId);
    return null;
  }

  const cfgSnap = await db.collection("config").doc("terminal").get();
  const cfgId =
    cfgSnap.exists && typeof cfgSnap.data()?.companyId === "string"
      ? (cfgSnap.data() as { companyId: string }).companyId.trim()
      : "";
  if (cfgId) {
    const companySnap = await db.collection("companies").doc(cfgId).get();
    if (companySnap.exists) return cfgId;
    console.error("[terminal-company] config/terminal.companyId neexistuje ve Firestore:", cfgId);
  }

  const allowFirstCompanyFallback =
    process.env.NODE_ENV !== "production" ||
    process.env.TERMINAL_ALLOW_FIRST_COMPANY_FALLBACK === "true";
  if (!allowFirstCompanyFallback) {
    console.error(
      "[terminal-company] V produkci nastavte TERMINAL_COMPANY_ID nebo Firestore config/terminal (companyId), případně TERMINAL_ALLOW_FIRST_COMPANY_FALLBACK=true."
    );
    return null;
  }

  const q = await db.collection("companies").orderBy(FieldPath.documentId()).limit(1).get();
  if (q.empty) {
    console.error("[terminal-company] Ve Firestore není žádná firma.");
    return null;
  }
  console.warn(
    "[terminal-company] Používám první firmu z Firestore (vývoj / výslovný opt-in). Není vhodné pro produkci."
  );
  return q.docs[0].id;
}

export async function getCompanyDisplayName(companyId: string): Promise<string> {
  const db = getAdminFirestore();
  if (!db) return "";
  const snap = await db.collection("companies").doc(companyId).get();
  if (!snap.exists) return "";
  const d = snap.data() as Record<string, unknown>;
  const cn = typeof d.companyName === "string" ? d.companyName.trim() : "";
  if (cn) return cn;
  const n = typeof d.name === "string" ? d.name.trim() : "";
  return n || "";
}
