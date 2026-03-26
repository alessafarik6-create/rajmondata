/**
 * Server-only: upsert importovaných poptávek do import_lead_overlays (synchronizace podle stabilního ID).
 */

import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import { stableImportLeadDocumentId } from "@/lib/import-lead-keys";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export type ImportLeadSyncStats = {
  created: number;
  updated: number;
  skipped: number;
  total: number;
};

function dedupeLeadRows(rows: LeadImportRow[]): LeadImportRow[] {
  const m = new Map<string, LeadImportRow>();
  for (const r of rows) {
    m.set(stableImportLeadDocumentId(r), r);
  }
  return [...m.values()];
}

function buildOverlayPayload(
  row: LeadImportRow,
  companyId: string,
  importUrl: string,
  existing: DocumentSnapshot
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    companyId,
    organizationId: companyId,
    externalId: row.id,
    sourceId: row.id,
    importLeadId: row.id,
    source: "import",
    importSourceUrl: importUrl,
    jmeno: row.jmeno,
    telefon: row.telefon,
    email: row.email,
    adresa: row.adresa,
    zprava: row.zprava,
    typ: row.typ,
    typ_poptavky: row.typ,
    stav: row.stav ?? "",
    datum_vytvoreni: row.receivedAtIso ?? null,
    receivedAtIso: row.receivedAtIso ?? null,
    lastSyncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (row.orientacniCenaKc != null && Number.isFinite(row.orientacniCenaKc)) {
    payload.orientacniCenaKc = row.orientacniCenaKc;
  }

  if (!existing.exists) {
    payload.createdAt = FieldValue.serverTimestamp();
    if (row.receivedAtIso) {
      const d = new Date(row.receivedAtIso);
      payload.receivedAt = Timestamp.fromDate(
        Number.isNaN(d.getTime()) ? new Date() : d
      );
    } else {
      payload.receivedAt = FieldValue.serverTimestamp();
    }
  } else {
    const data = existing.data() as Record<string, unknown> | undefined;
    if (data?.receivedAt == null) {
      if (row.receivedAtIso) {
        const d = new Date(row.receivedAtIso);
        payload.receivedAt = Timestamp.fromDate(
          Number.isNaN(d.getTime()) ? new Date() : d
        );
      } else {
        payload.receivedAt = FieldValue.serverTimestamp();
      }
    }
  }

  return payload;
}

/** Firestore getAll — bezpečný chunk (omezení služby). */
const GET_ALL_CHUNK = 10;
const BATCH_MAX = 450;

export async function syncImportLeadsToFirestoreAdmin(
  db: Firestore,
  companyId: string,
  rows: LeadImportRow[],
  importUrl: string
): Promise<ImportLeadSyncStats> {
  const rawCount = rows.length;
  const unique = dedupeLeadRows(rows);
  const skippedDuplicates = Math.max(0, rawCount - unique.length);
  const col = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("import_lead_overlays");

  let created = 0;
  let updated = 0;

  for (let offset = 0; offset < unique.length; offset += BATCH_MAX) {
    const slice = unique.slice(offset, offset + BATCH_MAX);
    const refs = slice.map((r) => col.doc(stableImportLeadDocumentId(r)));

    const snaps: DocumentSnapshot[] = [];
    for (let i = 0; i < refs.length; i += GET_ALL_CHUNK) {
      const part = refs.slice(i, i + GET_ALL_CHUNK);
      if (part.length === 0) continue;
      const got = await db.getAll(...part);
      snaps.push(...got);
    }

    if (snaps.length !== slice.length) {
      throw new Error(
        `[import-lead-sync] getAll length mismatch: expected ${slice.length}, got ${snaps.length}`
      );
    }

    const batch = db.batch();
    for (let k = 0; k < slice.length; k++) {
      const row = slice[k];
      const snap = snaps[k];
      if (snap.exists) updated++;
      else created++;

      const payload = buildOverlayPayload(row, companyId, importUrl, snap);
      batch.set(refs[k], payload, { merge: true });
    }
    await batch.commit();
  }

  return {
    created,
    updated,
    skipped: skippedDuplicates,
    total: unique.length,
  };
}
