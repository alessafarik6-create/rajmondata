import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  COMPANIES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  TERMINAL_LINKS_COLLECTION,
} from "@/lib/firestore-collections";

/** Přesné názvy v Firestore (čeština) — viz dokumentace / konzole logů. */
export const TERMINAL_LINK_ACTIVE_CZ = "aktivní";
export const TERMINAL_LINK_COMPANY_ID_CZ = "ID společnosti";

/** Fallbacky bez diakritiky / anglicky (tolerance špatného zápisu v konzoli). */
const ACTIVE_FIELD_ALIASES = ["aktivní", "aktivni"] as const;
const COMPANY_ID_FIELD_ALIASES = [
  "ID společnosti",
  "ID spolecnosti",
  "companyId",
] as const;

const SCAN_LIMIT = 200;

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

/** Aktivní: true, "true", 1 (a stringové varianty z UI). */
export function isActiveValue(v: unknown): boolean {
  if (v === true) return true;
  if (v === 1) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "ano";
  }
  return false;
}

function getRawActiveFromDoc(data: Record<string, unknown>): unknown {
  for (const key of ACTIVE_FIELD_ALIASES) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return data[key];
    }
  }
  return undefined;
}

function isDocActive(data: Record<string, unknown>): boolean {
  for (const key of ACTIVE_FIELD_ALIASES) {
    if (isActiveValue(data[key])) return true;
  }
  return false;
}

function isExpired(data: Record<string, unknown>): boolean {
  const exp = data.expiresAt as { toMillis?: () => number } | undefined;
  if (exp && typeof exp.toMillis === "function" && exp.toMillis() < Date.now()) return true;
  return false;
}

/** Company ID: kanonické pole + tolerantní aliasy. */
export function extractCompanyIdTolerant(data: Record<string, unknown>): string {
  for (const key of COMPANY_ID_FIELD_ALIASES) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
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
 * Kolekce: terminálOdkazy. Pole: aktivní, ID společnosti (+ tolerantní aliasy).
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
  console.log(
    "[terminal-config] collection:",
    TERMINAL_LINKS_COLLECTION,
    "| active fields tried:",
    [...ACTIVE_FIELD_ALIASES].join(", "),
    "| companyId fields tried:",
    [...COMPANY_ID_FIELD_ALIASES].join(", ")
  );

  let linkDocId = "";
  let linkData: Record<string, unknown> = {};

  try {
    const col = db.collection(TERMINAL_LINKS_COLLECTION);

    const scanSnap = await col.limit(SCAN_LIMIT).get();
    console.log(
      `[terminal-config] terminálOdkazy: ${scanSnap.size} document(s) loaded (limit ${SCAN_LIMIT})`
    );
    if (scanSnap.size === SCAN_LIMIT) {
      console.warn(
        `[terminal-config] terminálOdkazy má alespoň ${SCAN_LIMIT} dokumentů — ruční sken může minout aktivní záznam za tímto limitem.`
      );
    }

    if (!scanSnap.empty) {
      const first = scanSnap.docs[0].data() as Record<string, unknown>;
      console.log("[terminal-config] first document id:", scanSnap.docs[0].id);
      console.log("[terminal-config] first document keys:", Object.keys(first));
      console.log(
        "[terminal-config] raw pole aktivní:",
        first["aktivní"],
        "| aktivni:",
        first["aktivni"],
        "| typeof:",
        typeof first["aktivní"]
      );
      const rawA = getRawActiveFromDoc(first);
      console.log("[terminal-config] raw aktivní (first alias match):", rawA);
    }

    /** 1) Query where("aktivní", "==", true) */
    let snap = await col.where(TERMINAL_LINK_ACTIVE_CZ, "==", true).limit(1).get();
    if (snap.empty) {
      snap = await col.where(TERMINAL_LINK_ACTIVE_CZ, "==", "true").limit(1).get();
    }
    if (snap.empty) {
      snap = await col.where(TERMINAL_LINK_ACTIVE_CZ, "==", 1).limit(1).get();
    }

    if (!snap.empty) {
      linkDocId = snap.docs[0].id;
      linkData = snap.docs[0].data() as Record<string, unknown>;
      console.log("[terminal-config] Active terminal link found via query", linkDocId);
    } else {
      console.log(
        '[terminal-config] Query where("aktivní", "==", true|"true"|1) returned empty — falling back to manual scan'
      );
      for (const doc of scanSnap.docs) {
        const d = doc.data() as Record<string, unknown>;
        if (!isDocActive(d)) continue;
        if (isExpired(d)) continue;
        linkDocId = doc.id;
        linkData = d;
        const ra = getRawActiveFromDoc(d);
        console.log("[terminal-config] Active terminal link found (manual scan)", linkDocId, "raw aktivní:", ra);
        break;
      }
    }

    const collectionHasDocs = !scanSnap.empty;

    if (!linkDocId) {
      if (collectionHasDocs) {
        return {
          success: false,
          error:
            "Konfigurace terminálu existuje, ale nesedí názvy nebo typy polí (očekává se aktivní = true / „true“ / 1 a textové ID společnosti).",
          status: 400,
        };
      }
      return {
        success: false,
        error: "V kolekci terminálOdkazy není žádný dokument.",
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

    const companyId = extractCompanyIdTolerant(linkData);
    console.log("[terminal-config] resolved companyId:", companyId || "(empty)");

    if (!companyId) {
      return {
        success: false,
        error:
          collectionHasDocs
            ? "Konfigurace terminálu existuje, ale nesedí názvy nebo typy polí (chybí ID společnosti / companyId)."
            : "Chybí ID společnosti v dokumentu terminálOdkazy.",
        status: 400,
      };
    }

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
