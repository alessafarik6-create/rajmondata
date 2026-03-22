import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  COMPANIES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  TERMINAL_LINKS_COLLECTION,
  TERMINAL_LINK_ACTIVE_FIELD,
  TERMINAL_LINK_COMPANY_ID_FIELD,
} from "@/lib/firestore-collections";

/** Bezpečný JSON — Timestamp a podobné typy → ISO řetězec. */
export function serializeFirestoreData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null) {
      out[k] = v;
      continue;
    }
    if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
      try {
        out[k] = (v as { toDate: () => Date }).toDate().toISOString();
      } catch {
        out[k] = null;
      }
      continue;
    }
    if (typeof v === "object" && v !== null && "toMillis" in v && typeof (v as { toMillis: () => number }).toMillis === "function") {
      try {
        out[k] = new Date((v as { toMillis: () => number }).toMillis()).toISOString();
      } catch {
        out[k] = null;
      }
      continue;
    }
    out[k] = v as unknown;
  }
  return out;
}

function isActiveValue(v: unknown): boolean {
  if (v === true) return true;
  if (v === 1) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "ano";
  }
  return false;
}

function isExpired(data: Record<string, unknown>): boolean {
  const exp = data.expiresAt as { toMillis?: () => number } | undefined;
  if (exp && typeof exp.toMillis === "function" && exp.toMillis() < Date.now()) return true;
  return false;
}

function extractCompanyId(data: Record<string, unknown>): string {
  const raw = data[TERMINAL_LINK_COMPANY_ID_FIELD];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const alt = data.companyId;
  if (typeof alt === "string" && alt.trim()) return alt.trim();
  return "";
}

export type TerminalConfigLoadOk = {
  success: true;
  companyId: string;
  companyName: string;
  terminalConfig: Record<string, unknown> & { linkDocumentId: string };
};

export type TerminalConfigLoadErr = {
  success: false;
  error: string;
  status: 400 | 404 | 500;
};

/**
 * Veřejná konfigurace terminálu z Firestore — bez Firebase Auth.
 * 1) terminálOdkazy — aktivní záznam + ID společnosti
 * 2) ověření firmy ve společnosti (případně companies)
 */
export async function loadPublicTerminalConfig(): Promise<TerminalConfigLoadOk | TerminalConfigLoadErr> {
  const db = getAdminFirestore();
  if (!db) {
    return {
      success: false,
      error: "Server nemá nakonfigurovaný Firebase Admin SDK.",
      status: 500,
    };
  }

  console.log("Loading terminal config");

  let linkDocId = "";
  let linkData: Record<string, unknown> = {};

  try {
    const col = db.collection(TERMINAL_LINKS_COLLECTION);

    let snap = await col.where(TERMINAL_LINK_ACTIVE_FIELD, "==", true).limit(1).get();

    if (snap.empty) {
      snap = await col.where(TERMINAL_LINK_ACTIVE_FIELD, "==", "true").limit(1).get();
    }

    if (snap.empty) {
      const scan = await col.limit(50).get();
      for (const doc of scan.docs) {
        const d = doc.data() as Record<string, unknown>;
        if (!isActiveValue(d[TERMINAL_LINK_ACTIVE_FIELD])) continue;
        if (isExpired(d)) continue;
        linkDocId = doc.id;
        linkData = d;
        console.log("Active terminal link found (scan)", linkDocId);
        break;
      }
    } else {
      linkDocId = snap.docs[0].id;
      linkData = snap.docs[0].data() as Record<string, unknown>;
      console.log("Active terminal link found", linkDocId);
    }

    if (!linkDocId) {
      return {
        success: false,
        error:
          "Žádný aktivní záznam v terminálOdkazy (očekává se pole aktivní = true a ID společnosti).",
        status: 400,
      };
    }

    if (isExpired(linkData)) {
      return {
        success: false,
        error: "Aktivní odkaz terminálu má vypršené expiresAt.",
        status: 400,
      };
    }

    const companyId = extractCompanyId(linkData);
    if (!companyId) {
      return {
        success: false,
        error: "Dokument terminálOdkazy nemá vyplněné pole ID společnosti (ani companyId).",
        status: 400,
      };
    }

    console.log("Resolved companyId", companyId);

    const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).get();
    const compSnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
    if (!orgSnap.exists && !compSnap.exists) {
      return {
        success: false,
        error: `Firma s ID „${companyId}“ neexistuje ve společnosti ani v companies.`,
        status: 404,
      };
    }

    let companyName = "";
    const orgOrComp = orgSnap.exists ? orgSnap.data() : compSnap.data();
    if (orgOrComp) {
      const d = orgOrComp as Record<string, unknown>;
      companyName =
        (typeof d.companyName === "string" ? d.companyName.trim() : "") ||
        (typeof d.name === "string" ? d.name.trim() : "") ||
        "";
    }

    const terminalConfig = {
      ...serializeFirestoreData(linkData),
      linkDocumentId: linkDocId,
    };

    return {
      success: true,
      companyId,
      companyName: companyName || "Organizace",
      terminalConfig,
    };
  } catch (e) {
    console.error("Terminal config error", e);
    return {
      success: false,
      error: "Internal error",
      status: 500,
    };
  }
}
