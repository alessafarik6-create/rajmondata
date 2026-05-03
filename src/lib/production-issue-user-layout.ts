import type { Firestore } from "firebase/firestore";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

export type ProductionIssueUserLayoutDoc = {
  productionIssuePanelHeight?: number;
  /** Šířka PDF panelu v % vnitřního řádku (cca 28–72) */
  productionPdfPanelWidth?: number;
  /** Doplňkové % materiálu (může být 100 − PDF; ukládáme obě pro čitelnost) */
  productionMaterialPanelWidth?: number;
  /** Vnitřní výška horní sekce (výkres + sklad) v px */
  productionWorkbenchTopPx?: number;
  updatedAt?: unknown;
};

const LS_PREFIX = "productionIssueLayout";

export function productionIssueLayoutLocalKey(companyId: string, userId: string) {
  return `${LS_PREFIX}:${companyId}:${userId}`;
}

export function readProductionIssueLayoutFromLocalStorage(companyId: string, userId: string): ProductionIssueUserLayoutDoc | null {
  try {
    const raw = localStorage.getItem(productionIssueLayoutLocalKey(companyId, userId));
    if (!raw) return null;
    const j = JSON.parse(raw) as ProductionIssueUserLayoutDoc;
    if (!j || typeof j !== "object") return null;
    return j;
  } catch {
    return null;
  }
}

export function writeProductionIssueLayoutToLocalStorage(
  companyId: string,
  userId: string,
  patch: ProductionIssueUserLayoutDoc
): void {
  try {
    const prev = readProductionIssueLayoutFromLocalStorage(companyId, userId) || {};
    localStorage.setItem(
      productionIssueLayoutLocalKey(companyId, userId),
      JSON.stringify({ ...prev, ...patch, updatedAt: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function organizationUserSettingsDocRef(firestore: Firestore, userId: string, companyId: string) {
  return doc(firestore, "users", userId, "organizationSettings", companyId);
}

export async function loadProductionIssueUserLayout(
  firestore: Firestore,
  userId: string,
  companyId: string
): Promise<ProductionIssueUserLayoutDoc | null> {
  try {
    const snap = await getDoc(organizationUserSettingsDocRef(firestore, userId, companyId));
    if (!snap.exists()) return null;
    const d = snap.data() as Record<string, unknown>;
    const out: ProductionIssueUserLayoutDoc = {};
    const h = d.productionIssuePanelHeight;
    const pw = d.productionPdfPanelWidth;
    const mw = d.productionMaterialPanelWidth;
    const top = d.productionWorkbenchTopPx;
    if (typeof h === "number" && Number.isFinite(h)) out.productionIssuePanelHeight = h;
    if (typeof pw === "number" && Number.isFinite(pw)) out.productionPdfPanelWidth = pw;
    if (typeof mw === "number" && Number.isFinite(mw)) out.productionMaterialPanelWidth = mw;
    if (typeof top === "number" && Number.isFinite(top)) out.productionWorkbenchTopPx = top;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export async function saveProductionIssueUserLayout(
  firestore: Firestore,
  userId: string,
  companyId: string,
  patch: ProductionIssueUserLayoutDoc
): Promise<void> {
  const ref = organizationUserSettingsDocRef(firestore, userId, companyId);
  await setDoc(
    ref,
    {
      ...patch,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
