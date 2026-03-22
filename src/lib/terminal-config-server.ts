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
  "companyID",
  "idSpolecnosti",
] as const;

const SCAN_LIMIT = 200;

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

/** Aktivní terminál: true, "true", 1, "1", "ano" (case-insensitive). */
export function normalizeBooleanValue(value: unknown): boolean {
  if (value === true) return true;
  if (value === 1) return true;
  if (typeof value === "number" && Number.isFinite(value) && value === 1) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "true" || s === "1" || s === "ano";
  }
  return false;
}

/** Zpětná kompatibilita — stejné jako {@link normalizeBooleanValue}. */
export function isActiveValue(v: unknown): boolean {
  return normalizeBooleanValue(v);
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
    if (Object.prototype.hasOwnProperty.call(data, key) && normalizeBooleanValue(data[key])) {
      return true;
    }
  }
  return false;
}

function isExpired(data: Record<string, unknown>): boolean {
  const exp = data.expiresAt as { toMillis?: () => number } | undefined;
  if (exp && typeof exp.toMillis === "function" && exp.toMillis() < Date.now()) return true;
  return false;
}

function isFirestoreDocRefLike(v: unknown): v is { id: string } {
  return typeof v === "object" && v !== null && "id" in v && typeof (v as { id: unknown }).id === "string";
}

/** ID firmy z dokumentu terminálOdkazy — tolerantně k názvům polí a typům. */
export function resolveCompanyId(data: Record<string, unknown>): string {
  for (const key of COMPANY_ID_FIELD_ALIASES) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (isFirestoreDocRefLike(v) && v.id.trim()) return v.id.trim();
  }
  return "";
}

/** @deprecated použij {@link resolveCompanyId} */
export function extractCompanyIdTolerant(data: Record<string, unknown>): string {
  return resolveCompanyId(data);
}

function serializeDebugScalar(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof v === "object" && v !== null && "toMillis" in v && typeof (v as { toMillis: () => number }).toMillis === "function") {
    try {
      return new Date((v as { toMillis: () => number }).toMillis()).toISOString();
    } catch {
      return null;
    }
  }
  return v;
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
  /** Diagnostika při nesedících polích (první dokument nebo poslední kontrolovaný). */
  foundKeys?: string[];
  activeRawValue?: unknown;
  resolvedCompanyId?: string;
  docInspections?: Array<{
    docId: string;
    keys: string[];
    rawActive: unknown;
    resolvedCompanyId: string;
    isActive: boolean;
    skipped?: string;
  }>;
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
 * Čte pouze kolekci terminálOdkazy; aktivní záznam hledá ručním průchodem dokumentů.
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

  let scanSnapSize = 0;

  let debugBase: Awaited<ReturnType<typeof buildDebugBase>> | undefined;

  try {
    debugBase = await buildDebugBase(db);

    const coll = db.collection(TERMINAL_LINKS_COLLECTION);
    const scanSnap = await coll.limit(SCAN_LIMIT).get();
    scanSnapSize = scanSnap.size;

    console.log(`[terminal-config] collection("${TERMINAL_LINKS_COLLECTION}").limit(${SCAN_LIMIT}) -> docsCount: ${scanSnapSize}`);

    if (scanSnap.empty) {
      return {
        success: false,
        error:
          "Route nevidí žádné dokumenty v terminálOdkazy — pravděpodobně čte jiný Firebase projekt než konzole, nebo je jiný název kolekce. Zkontrolujte FIREBASE_PROJECT_ID na serveru (měl by odpovídat NEXT_PUBLIC_FIREBASE_PROJECT_ID).",
        status: 400,
        debug: {
          collectionName: TERMINAL_LINKS_COLLECTION,
          usedCollectionName: TERMINAL_LINKS_COLLECTION,
          docsCount: 0,
          ...debugBase,
          projectId: adm.adminAppProjectId ?? adm.envFirebaseProjectId,
        },
      };
    }

    const first = scanSnap.docs[0];
    const firstData = first.data() as Record<string, unknown>;
    const firstKeys = Object.keys(firstData);
    console.log("[terminal-config] first document id:", first.id);
    console.log("[terminal-config] first document keys:", firstKeys);
    console.log("[terminal-config] first document data (serialized):", JSON.stringify(serializeFirestoreData(firstData)));

    const docInspections: NonNullable<TerminalConfigDebug["docInspections"]> = [];

    let linkDocId = "";
    let linkData: Record<string, unknown> = {} as Record<string, unknown>;

    for (const doc of scanSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const keys = Object.keys(d);
      const rawActive = getRawActiveFromDoc(d);
      const cid = resolveCompanyId(d);
      const active = isDocActive(d);
      let skipped: string | undefined;

      console.log(`[terminal-config] doc ${doc.id} keys:`, keys);
      console.log(`[terminal-config] doc ${doc.id} raw aktivní/aktivni:`, serializeDebugScalar(rawActive));
      console.log(`[terminal-config] doc ${doc.id} resolved companyId:`, cid || "(empty)");

      if (isExpired(d)) {
        skipped = "expiresAt";
      } else if (!active) {
        skipped = "not active";
      } else if (!cid) {
        skipped = "missing company id";
      }

      docInspections.push({
        docId: doc.id,
        keys,
        rawActive: serializeDebugScalar(rawActive),
        resolvedCompanyId: cid,
        isActive: active,
        skipped,
      });

      if (skipped) continue;

      linkDocId = doc.id;
      linkData = d;
      console.log("[terminal-config] matched terminal link document:", linkDocId, "companyId:", cid);
      break;
    }

    if (!linkDocId) {
      const last = docInspections[docInspections.length - 1];
      return {
        success: false,
        error:
          "Konfigurace terminálu existuje, ale žádný dokument není zároveň aktivní (aktivní/aktivni) a nemá platné ID společnosti. Zkontrolujte pole v terminálOdkazy.",
        status: 400,
        debug: {
          collectionName: TERMINAL_LINKS_COLLECTION,
          usedCollectionName: TERMINAL_LINKS_COLLECTION,
          docsCount: scanSnapSize,
          ...debugBase,
          projectId: adm.adminAppProjectId ?? adm.envFirebaseProjectId,
          firstDocId: first.id,
          firstDocKeys: firstKeys,
          foundKeys: last?.keys ?? firstKeys,
          activeRawValue: last ? serializeDebugScalar(last.rawActive) : serializeDebugScalar(getRawActiveFromDoc(firstData)),
          resolvedCompanyId: last?.resolvedCompanyId ?? resolveCompanyId(firstData),
          docInspections,
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
          usedCollectionName: TERMINAL_LINKS_COLLECTION,
          docsCount: scanSnapSize,
          ...debugBase,
          firstDocKeys: Object.keys(linkData),
        },
      };
    }

    const companyId = resolveCompanyId(linkData);
    console.log("[terminal-config] final resolved companyId:", companyId || "(empty)");

    if (!companyId) {
      return {
        success: false,
        error: "Chybí ID společnosti v aktivním dokumentu terminálOdkazy.",
        status: 400,
        debug: {
          collectionName: TERMINAL_LINKS_COLLECTION,
          usedCollectionName: TERMINAL_LINKS_COLLECTION,
          docsCount: scanSnapSize,
          ...debugBase,
          foundKeys: Object.keys(linkData),
          activeRawValue: serializeDebugScalar(getRawActiveFromDoc(linkData)),
          resolvedCompanyId: "",
          docInspections,
        },
      };
    }

    const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).get();
    const compSnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();

    if (!orgSnap.exists && !compSnap.exists) {
      return {
        success: false,
        error: `Firma s ID „${companyId}“ neexistuje v kolekci společnosti ani v companies.`,
        status: 404,
        debug: {
          collectionName: TERMINAL_LINKS_COLLECTION,
          usedCollectionName: TERMINAL_LINKS_COLLECTION,
          docsCount: scanSnapSize,
          projectId: adm.adminAppProjectId ?? adm.envFirebaseProjectId,
          resolvedCompanyId: companyId,
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
