import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore, getFirebaseAdminDebugSummary } from "@/lib/firebase-admin";
import {
  COMPANIES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  TERMINAL_LINKS_COLLECTION,
} from "@/lib/firestore-collections";

/** Kanonický název v konzoli Firestore — musí odpovídat projektu. */
export const TERMINAL_LINK_ACTIVE_CZ = "aktivní";
export const TERMINAL_LINK_COMPANY_ID_CZ = "ID společnosti";

const ACTIVE_FIELD_ALIASES = ["aktivní", "aktivni"] as const;
const COMPANY_ID_FIELD_ALIASES = [
  "ID společnosti",
  "ID spolecnosti",
  "companyId",
] as const;

const SCAN_LIMIT = 200;

/**
 * Kandidáti na název kolekce (překlepy / bez diakritiky).
 * Primární je vždy `terminálOdkazy` z firestore-collections.
 */
const TERMINAL_LINK_COLLECTION_CANDIDATES = [
  TERMINAL_LINKS_COLLECTION,
  "terminalOdkazy",
  "terminalodkazy",
  "terminalLinks",
  "terminal-links",
] as const;

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

export function extractCompanyIdTolerant(data: Record<string, unknown>): string {
  for (const key of COMPANY_ID_FIELD_ALIASES) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

export type TerminalConfigDebug = {
  collectionName: string;
  usedCollectionName?: string;
  projectId?: string | null;
  docsCount: number;
  envFirebaseProjectId?: string | null;
  envNextPublicFirebaseProjectId?: string | null;
  adminAppProjectId?: string | null;
  appsCount?: number;
  firestoreDatabaseId?: string;
  projectIdMismatchWithPublic?: boolean;
  topLevelCollectionNames?: string[];
  listCollectionsError?: string;
  triedCollectionNames?: readonly string[];
  firstDocId?: string | null;
  firstDocKeys?: string[];
};

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
  debug?: TerminalConfigDebug;
};

async function buildDebugBase(db: Firestore): Promise<Omit<TerminalConfigDebug, "collectionName" | "docsCount">> {
  const adm = getFirebaseAdminDebugSummary();
  let topLevelCollectionNames: string[] = [];
  let listCollectionsError: string | undefined;
  try {
    const refs = await db.listCollections();
    topLevelCollectionNames = refs.map((r) => r.id);
  } catch (e) {
    listCollectionsError = (e as Error).message;
  }
  const projectIdMismatchWithPublic =
    !!adm.envFirebaseProjectId &&
    !!adm.envNextPublicFirebaseProjectId &&
    adm.envFirebaseProjectId !== adm.envNextPublicFirebaseProjectId;

  return {
    projectId: adm.adminAppProjectId ?? adm.envFirebaseProjectId,
    envFirebaseProjectId: adm.envFirebaseProjectId,
    envNextPublicFirebaseProjectId: adm.envNextPublicFirebaseProjectId,
    adminAppProjectId: adm.adminAppProjectId,
    appsCount: adm.appsCount,
    firestoreDatabaseId: adm.firestoreDatabaseId,
    projectIdMismatchWithPublic,
    topLevelCollectionNames: topLevelCollectionNames.slice(0, 100),
    listCollectionsError,
  };
}

/**
 * Veřejná konfigurace terminálu — bez Firebase Auth.
 * Nejprve prosté .limit(10).get() na kandidátech kolekcí, pak výběr aktivního záznamu.
 */
export async function loadPublicTerminalConfig(): Promise<TerminalConfigLoadOk | TerminalConfigLoadErr> {
  console.log("Loading terminal config");
  console.log("[terminal-config] process.env.FIREBASE_PROJECT_ID =", process.env.FIREBASE_PROJECT_ID ?? "(unset)");
  console.log(
    "[terminal-config] process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID =",
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "(unset)"
  );

  const db = getAdminFirestore();
  const adm = getFirebaseAdminDebugSummary();
  console.log("[terminal-config] firebase-admin debug:", adm);

  if (!db) {
    return {
      success: false,
      error: "Server nemá nakonfigurovaný Firebase Admin SDK (chybí env nebo init).",
      status: 500,
      debug: {
        collectionName: TERMINAL_LINKS_COLLECTION,
        docsCount: -1,
        ...adm,
        projectId: adm.adminAppProjectId,
      },
    };
  }

  let linkDocId = "";
  let linkData: Record<string, unknown> = {};
  let usedCollectionName = "";
  let scanSnapSize = 0;

  let debugBase: Awaited<ReturnType<typeof buildDebugBase>> | undefined;

  try {
    debugBase = await buildDebugBase(db);

    let col = db.collection(TERMINAL_LINKS_COLLECTION);
    let foundNonEmpty = false;

    for (const name of TERMINAL_LINK_COLLECTION_CANDIDATES) {
      col = db.collection(name);
      const snap10 = await col.limit(10).get();
      console.log(`[terminal-config] collection("${name}").limit(10).get() -> docs: ${snap10.size}`);
      if (!snap10.empty) {
        foundNonEmpty = true;
        usedCollectionName = name;
        const first = snap10.docs[0];
        const raw = first.data() as Record<string, unknown>;
        console.log("[terminal-config] first document id:", first.id);
        console.log("[terminal-config] first document keys:", Object.keys(raw));
        console.log(
          "[terminal-config] first doc aktivní / aktivni:",
          raw["aktivní"],
          raw["aktivni"],
          "typeof aktivní:",
          typeof raw["aktivní"]
        );
        console.log("[terminal-config] first doc sample (serialized):", JSON.stringify(serializeFirestoreData(raw)));

        const scanSnap = await db.collection(name).limit(SCAN_LIMIT).get();
        scanSnapSize = scanSnap.size;
        console.log(`[terminal-config] collection("${name}").limit(${SCAN_LIMIT}) -> ${scanSnapSize} docs`);

        /** Query where aktivní */
        let snap = await db.collection(name).where(TERMINAL_LINK_ACTIVE_CZ, "==", true).limit(1).get();
        if (snap.empty) {
          snap = await db.collection(name).where(TERMINAL_LINK_ACTIVE_CZ, "==", "true").limit(1).get();
        }
        if (snap.empty) {
          snap = await db.collection(name).where(TERMINAL_LINK_ACTIVE_CZ, "==", 1).limit(1).get();
        }
        if (snap.empty) {
          snap = await db.collection(name).where("aktivni", "==", true).limit(1).get();
        }
        if (snap.empty) {
          snap = await db.collection(name).where("aktivni", "==", "true").limit(1).get();
        }

        if (!snap.empty) {
          linkDocId = snap.docs[0].id;
          linkData = snap.docs[0].data() as Record<string, unknown>;
          console.log("[terminal-config] Active link via query", linkDocId);
        } else {
          console.log('[terminal-config] query empty — manual scan for aktivní');
          for (const doc of scanSnap.docs) {
            const d = doc.data() as Record<string, unknown>;
            if (!isDocActive(d)) continue;
            if (isExpired(d)) continue;
            linkDocId = doc.id;
            linkData = d;
            console.log("[terminal-config] Active link via manual scan", linkDocId);
            break;
          }
        }
        break;
      }
    }

    if (!foundNonEmpty) {
      return {
        success: false,
        error:
          "Route nevidí žádné dokumenty v terminálOdkazy — pravděpodobně čte jiný Firebase projekt než konzole, nebo je jiný název kolekce. Zkontrolujte FIREBASE_PROJECT_ID na serveru (měl by odpovídat NEXT_PUBLIC_FIREBASE_PROJECT_ID).",
        status: 400,
        debug: {
          collectionName: TERMINAL_LINKS_COLLECTION,
          usedCollectionName: undefined,
          docsCount: 0,
          triedCollectionNames: TERMINAL_LINK_COLLECTION_CANDIDATES,
          ...debugBase,
          projectId: adm.adminAppProjectId ?? adm.envFirebaseProjectId,
        },
      };
    }

    const collectionHasDocs = scanSnapSize > 0;

    if (!linkDocId) {
      if (collectionHasDocs) {
        return {
          success: false,
          error:
            "Konfigurace terminálu existuje, ale nesedí názvy nebo typy polí (aktivní / ID společnosti).",
          status: 400,
          debug: {
            collectionName: TERMINAL_LINKS_COLLECTION,
            usedCollectionName,
            docsCount: scanSnapSize,
            ...debugBase,
            projectId: adm.adminAppProjectId ?? adm.envFirebaseProjectId,
            triedCollectionNames: TERMINAL_LINK_COLLECTION_CANDIDATES,
          },
        };
      }
      return {
        success: false,
        error: "V kolekci terminálOdkazy není žádný dokument.",
        status: 400,
        debug: {
          collectionName: TERMINAL_LINKS_COLLECTION,
          docsCount: 0,
          ...debugBase,
        },
      };
    }

    if (isExpired(linkData)) {
      return {
        success: false,
        error: "Aktivní odkaz terminálu má vypršené expiresAt.",
        status: 400,
        debug: {
          collectionName: TERMINAL_LINKS_COLLECTION,
          usedCollectionName,
          docsCount: scanSnapSize,
          ...debugBase,
        },
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
        debug: {
          collectionName: TERMINAL_LINKS_COLLECTION,
          usedCollectionName,
          docsCount: scanSnapSize,
          ...debugBase,
          firstDocKeys: Object.keys(linkData),
        },
      };
    }

    const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).get();
    const compSnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
    if (!orgSnap.exists && !compSnap.exists) {
      return {
        success: false,
        error: `Firma s ID „${companyId}“ neexistuje ve společnosti ani v companies.`,
        status: 404,
        debug: {
          collectionName: TERMINAL_LINKS_COLLECTION,
          usedCollectionName,
          docsCount: scanSnapSize,
          projectId: adm.adminAppProjectId ?? adm.envFirebaseProjectId,
        },
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
    const admErr = getFirebaseAdminDebugSummary();
    return {
      success: false,
      error: "Internal error",
      status: 500,
      debug: {
        collectionName: TERMINAL_LINKS_COLLECTION,
        docsCount: scanSnapSize,
        ...(debugBase ?? {
          projectId: admErr.adminAppProjectId ?? admErr.envFirebaseProjectId,
          envFirebaseProjectId: admErr.envFirebaseProjectId,
          envNextPublicFirebaseProjectId: admErr.envNextPublicFirebaseProjectId,
          adminAppProjectId: admErr.adminAppProjectId,
          appsCount: admErr.appsCount,
          firestoreDatabaseId: admErr.firestoreDatabaseId,
          projectIdMismatchWithPublic:
            !!admErr.envFirebaseProjectId &&
            !!admErr.envNextPublicFirebaseProjectId &&
            admErr.envFirebaseProjectId !== admErr.envNextPublicFirebaseProjectId,
        }),
        listCollectionsError: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
