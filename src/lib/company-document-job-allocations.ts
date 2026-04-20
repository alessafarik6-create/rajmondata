/**
 * Rozdělení přijatého dokladu (náklad) mezi více zakázek + volitelná režie.
 * Zpětná kompatibilita: bez `jobCostAllocations` se použije jediná zakázka z jobId/zakazkaId.
 */

import type { CompanyDocumentLike } from "@/lib/company-documents-financial";
import { roundMoney2 } from "@/lib/vat-calculations";

type DocAmountFields = CompanyDocumentLike & Record<string, unknown>;

export type JobCostAllocationMode = "amount" | "percent";

export type JobCostAllocationRow = {
  id: string;
  kind: "job" | "overhead";
  jobId?: string | null;
  /** Režim „částka“: hrubá částka v CZK (stejný základ jako castkaCZK dokladu). */
  amount?: number | null;
  /** Režim „procenta“: podíl z celku dokladu (0–100). */
  percent?: number | null;
  note?: string | null;
  linkedExpenseId?: string | null;
};

/** Tolerance zaokrouhlení (Kč / %) — příliš přísná hodnota blokovala uložení po přepočtu DPH. */
const SUM_EPS = 0.05;

/** Hrubý základ v CZK pro rozdělení (shodně s náklady v zakázce). */
export function allocationBasisGrossCzk(doc: DocAmountFields): number {
  const czk = roundMoney2(
    Number(doc.castkaCZK ?? doc.amountGrossCZK ?? 0)
  );
  if (czk > 0) return czk;
  return roundMoney2(
    Number(doc.castka ?? doc.amountGross ?? doc.amount ?? 0)
  );
}

export function makeJobCostAllocationId(): string {
  return `jca_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Firestore / starší importy občas uloží „pole“ jako mapu { "0": row, "1": row }.
 * Bez převodu by `Array.isArray` selhalo a rozdělení by se nenačetlo ani nepropsalo.
 */
function coerceFirestoreAllocationArray(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => /^\d+$/.test(k));
    if (keys.length > 0) {
      return keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => o[k])
        .filter((x) => x != null);
    }
  }
  return [];
}

/** Pole alokací z dokumentu — primárně `jobCostAllocations`, alternativně `allocations`. */
export function documentJobCostAllocationsArray(
  doc: Record<string, unknown>
): unknown[] {
  const primary = coerceFirestoreAllocationArray(doc.jobCostAllocations);
  if (primary.length > 0) return primary;
  const alt = coerceFirestoreAllocationArray(doc.allocations);
  if (alt.length > 0) return alt;
  return [];
}

/** Režim rozdělení: `jobCostAllocationMode` nebo alias `allocationMode`. */
export function documentJobCostAllocationMode(
  doc: Record<string, unknown>
): JobCostAllocationMode {
  const m = doc.jobCostAllocationMode ?? doc.allocationMode;
  return m === "percent" ? "percent" : "amount";
}

/** Převod z Firestore (bez id) na řádek s id. */
export function normalizeJobCostAllocationRows(
  raw: unknown
): JobCostAllocationRow[] {
  if (!Array.isArray(raw)) return [];
  const out: JobCostAllocationRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i];
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const jobIdRaw =
      typeof o.jobId === "string" && o.jobId.trim() ? o.jobId.trim() : null;
    let kind: "job" | "overhead";
    if (o.kind === "overhead") kind = "overhead";
    else if (o.kind === "job") kind = "job";
    else {
      kind = jobIdRaw ? "job" : "overhead";
    }
    /** Stabilní id při chybějícím poli `id` (jinak by se při každém načtení měnilo a rozbilo vazbu na náklady). */
    const id =
      typeof o.id === "string" && o.id.trim()
        ? o.id.trim()
        : `jca_auto_${i}_${kind}_${jobIdRaw ?? "oh"}`;
    out.push({
      id,
      kind,
      jobId: kind === "job" ? jobIdRaw : null,
      amount: o.amount != null ? Number(o.amount) : null,
      percent: o.percent != null ? Number(o.percent) : null,
      note: o.note != null ? String(o.note) : null,
      linkedExpenseId:
        typeof o.linkedExpenseId === "string" && o.linkedExpenseId.trim()
          ? o.linkedExpenseId.trim()
          : null,
    });
  }
  return out;
}

/**
 * Virtuální řádky alokace: buď z pole `jobCostAllocations`, nebo jeden legacy řádek z jobId.
 */
export function resolveJobCostAllocationsFromDocument(doc: {
  jobCostAllocations?: unknown;
  allocations?: unknown;
  jobCostAllocationMode?: unknown;
  allocationMode?: unknown;
  jobId?: string | null;
  zakazkaId?: string | null;
  assignmentType?: string | null;
}): {
  mode: JobCostAllocationMode;
  rows: JobCostAllocationRow[];
  usesExplicitAllocations: boolean;
} {
  const docRec = doc as Record<string, unknown>;
  const rows = normalizeJobCostAllocationRows(
    documentJobCostAllocationsArray(docRec)
  );
  const mode = documentJobCostAllocationMode(docRec);
  if (rows.length > 0) {
    return { mode, rows, usesExplicitAllocations: true };
  }
  const jid = String(doc.zakazkaId ?? doc.jobId ?? "").trim();
  if (doc.assignmentType === "job_cost" && jid) {
    return {
      mode: "amount",
      rows: [
        {
          id: makeJobCostAllocationId(),
          kind: "job",
          jobId: jid,
          amount: null,
          percent: null,
          note: null,
          linkedExpenseId: null,
        },
      ],
      usesExplicitAllocations: false,
    };
  }
  return { mode, rows: [], usesExplicitAllocations: false };
}

/** Zjednodušený zápis pro export / alias pole `allocations` na dokumentu. */
export function allocationsMirrorForDocument(rows: JobCostAllocationRow[]): {
  jobId: string | null;
  percent: number | null;
  amount: number | null;
  note: string;
}[] {
  return rows.map((r) => ({
    jobId: r.kind === "job" ? r.jobId?.trim() ?? null : null,
    percent:
      r.percent != null && Number.isFinite(Number(r.percent))
        ? Number(r.percent)
        : null,
    amount:
      r.amount != null && Number.isFinite(Number(r.amount))
        ? roundMoney2(Number(r.amount))
        : null,
    note: r.note?.trim() ? String(r.note) : "",
  }));
}

export function allocationJobIdsFromRows(rows: JobCostAllocationRow[]): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    if (r.kind === "job" && r.jobId?.trim()) s.add(r.jobId.trim());
  }
  return [...s];
}

export type AllocationValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateJobCostAllocations(params: {
  mode: JobCostAllocationMode;
  rows: JobCostAllocationRow[];
  basisGrossCzk: number;
}): AllocationValidationResult {
  const { mode, rows, basisGrossCzk } = params;
  if (basisGrossCzk <= 0) {
    return { ok: false, message: "Doklad nemá kladnou částku k rozdělení." };
  }
  if (rows.length === 0) {
    return { ok: false, message: "Přidejte alespoň jeden řádek rozdělení." };
  }
  const jobRows = rows.filter((r) => r.kind === "job");
  const ohRows = rows.filter((r) => r.kind === "overhead");
  if (jobRows.length === 0 && ohRows.length === 0) {
    return { ok: false, message: "Chybí řádky rozdělení." };
  }
  for (const r of jobRows) {
    if (!r.jobId?.trim()) {
      return { ok: false, message: "U každého řádku zakázky vyberte zakázku." };
    }
  }
  const jobIdsSeen = new Set<string>();
  for (const r of jobRows) {
    const jid = r.jobId!.trim();
    if (jobIdsSeen.has(jid)) {
      return {
        ok: false,
        message:
          "Stejná zakázka je ve více řádcích rozdělení. Sloučte řádky nebo zvolte jiné zakázky.",
      };
    }
    jobIdsSeen.add(jid);
  }
  if (mode === "amount") {
    let sumAmt = 0;
    for (const r of rows) {
      const a = Number(r.amount ?? 0);
      if (!Number.isFinite(a) || a < 0) {
        return { ok: false, message: "Částky musí být nezáporné čísla." };
      }
      sumAmt += a;
    }
    if (Math.abs(sumAmt - basisGrossCzk) > SUM_EPS) {
      return {
        ok: false,
        message: `Součet částek (${roundMoney2(sumAmt).toLocaleString("cs-CZ")} Kč) musí odpovídat částce dokladu (${roundMoney2(basisGrossCzk).toLocaleString("cs-CZ")} Kč).`,
      };
    }
  } else {
    let sumP = 0;
    for (const r of rows) {
      const p = Number(r.percent ?? 0);
      if (!Number.isFinite(p) || p < 0) {
        return { ok: false, message: "Procenta musí být nezáporná čísla." };
      }
      sumP += p;
    }
    if (Math.abs(sumP - 100) > SUM_EPS) {
      return {
        ok: false,
        message: `Součet procent musí být 100 % (nyní ${roundMoney2(sumP)} %).`,
      };
    }
  }
  return { ok: true };
}

/** Hrubé částky v CZK pro každý řádek (včetně režie — ta může mít jobId null). */
export function computeAllocationGrossCzkShares(params: {
  mode: JobCostAllocationMode;
  rows: JobCostAllocationRow[];
  basisGrossCzk: number;
}): Map<string, number> {
  const { mode, rows, basisGrossCzk } = params;
  const map = new Map<string, number>();
  if (basisGrossCzk <= 0) return map;

  if (mode === "amount") {
    for (const r of rows) {
      const g = roundMoney2(Number(r.amount ?? 0));
      map.set(r.id, g);
    }
    return map;
  }

  let acc = 0;
  const nonOh = rows.filter((r) => r.kind === "job");
  const oh = rows.filter((r) => r.kind === "overhead");
  const ordered = [...nonOh, ...oh];
  for (let i = 0; i < ordered.length; i++) {
    const r = ordered[i];
    const p = Number(r.percent ?? 0);
    if (i === ordered.length - 1) {
      map.set(r.id, roundMoney2(basisGrossCzk - acc));
    } else {
      const g = roundMoney2((basisGrossCzk * p) / 100);
      acc += g;
      map.set(r.id, g);
    }
  }
  return map;
}

/** Pouze řádky zakázek s kladným podílem — pro synchronizaci nákladů. */
export function jobExpenseSlicesFromAllocations(
  doc: DocAmountFields & {
    jobCostAllocations?: unknown;
    jobCostAllocationMode?: unknown;
    assignmentType?: string;
    jobId?: string | null;
    zakazkaId?: string | null;
    linkedExpenseId?: string | null;
  }
): {
  mode: JobCostAllocationMode;
  rows: JobCostAllocationRow[];
  usesExplicitAllocations: boolean;
  slices: { rowId: string; jobId: string; grossCzk: number; expenseId: string | null }[];
} {
  const { mode, rows, usesExplicitAllocations } =
    resolveJobCostAllocationsFromDocument(doc);
  const basis = allocationBasisGrossCzk(doc);
  const grossByRow = computeAllocationGrossCzkShares({
    mode: usesExplicitAllocations ? mode : "amount",
    rows,
    basisGrossCzk: basis,
  });

  const slices: {
    rowId: string;
    jobId: string;
    grossCzk: number;
    expenseId: string | null;
  }[] = [];

  if (!usesExplicitAllocations && rows.length === 1 && rows[0].kind === "job") {
    const jid = rows[0].jobId?.trim();
    if (jid && basis > 0) {
      slices.push({
        rowId: rows[0].id,
        jobId: jid,
        grossCzk: basis,
        expenseId: doc.linkedExpenseId?.trim() || rows[0].linkedExpenseId || null,
      });
    }
    return { mode, rows, usesExplicitAllocations, slices };
  }

  for (const r of rows) {
    if (r.kind !== "job" || !r.jobId?.trim()) continue;
    const g = grossByRow.get(r.id) ?? 0;
    if (g <= 0) continue;
    slices.push({
      rowId: r.id,
      jobId: r.jobId.trim(),
      grossCzk: g,
      expenseId: r.linkedExpenseId?.trim() || null,
    });
  }
  return { mode, rows, usesExplicitAllocations, slices };
}
