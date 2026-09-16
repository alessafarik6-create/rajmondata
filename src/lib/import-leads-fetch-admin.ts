/**
 * Server-only: načtení řádků poptávek z externí import URL organizace.
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import { parseLeadImportPayload, type LeadImportRow } from "@/lib/lead-import-parse";
import { syncImportLeadsToFirestoreAdmin } from "@/lib/import-lead-sync-firestore";

const FETCH_TIMEOUT_MS = 25_000;

function isAllowedImportUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function resolveImportUrl(db: Firestore, companyId: string): Promise<string | null> {
  const [companySnap, orgSnap] = await Promise.all([
    db.collection(COMPANIES_COLLECTION).doc(companyId).get(),
    db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).get(),
  ]);
  const fromCompany = companySnap.data()?.poptavkyImportUrl;
  const fromOrg = orgSnap.data()?.poptavkyImportUrl;
  const raw =
    (typeof fromCompany === "string" && fromCompany.trim()) ||
    (typeof fromOrg === "string" && fromOrg.trim()) ||
    "";
  return raw || null;
}

export async function fetchCompanyImportLeadRowsAdmin(
  db: Firestore,
  companyId: string
): Promise<{ rows: LeadImportRow[]; warning?: string }> {
  const importUrl = await resolveImportUrl(db, companyId);
  if (!importUrl) {
    return { rows: [], warning: "Není nastavená URL pro import poptávek." };
  }
  if (!isAllowedImportUrl(importUrl)) {
    return { rows: [], warning: "Neplatná importní URL." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(importUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "Rajmondata-import-leads/1.0",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      return {
        rows: [],
        warning: `Import poptávek selhal (HTTP ${upstream.status}).`,
      };
    }

    const text = (await upstream.text()).trim();
    if (!text) return { rows: [] };

    if (!text.startsWith("{") && !text.startsWith("[")) {
      return { rows: [], warning: "Importní zdroj nevrátil JSON." };
    }

    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return { rows: [], warning: "Importní JSON nelze parsovat." };
    }

    const rows = parseLeadImportPayload(json);

    try {
      await syncImportLeadsToFirestoreAdmin(db, companyId, rows, importUrl);
    } catch (e) {
      console.warn("[import-leads-fetch-admin] sync failed", e);
    }

    return { rows };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      rows: [],
      warning: aborted
        ? "Časový limit při stahování importu poptávek."
        : "Nelze se připojit k importní URL.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
