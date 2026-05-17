/**
 * Ruční údaje smlouvy a zálohy na dokumentu zakázky (companies/{id}/jobs/{id}.contractManual).
 */

import { roundMoney2 } from "@/lib/vat-calculations";

export const JOB_CONTRACT_MANUAL_FIELD = "contractManual" as const;

export type ManualDepositPayment = {
  id: string;
  /** ISO YYYY-MM-DD */
  paidAt: string | null;
  amountGross: number;
  note?: string | null;
};

export type JobContractManualData = {
  isContracted?: boolean;
  /** ISO datum YYYY-MM-DD */
  contractedAt?: string | null;
  contractNumber?: string | null;
  totalPriceGross?: number | null;
  requiredDepositGross?: number | null;
  /** Legacy — použije se jen pokud chybí {@link manualDepositPayments}. */
  paidDepositGross?: number | null;
  manualDepositPayments?: ManualDepositPayment[];
  depositNote?: string | null;
};

function formatKcInline(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

export function createManualDepositPaymentId(): string {
  return `mdp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function parseManualDepositPayments(raw: unknown): ManualDepositPayment[] {
  if (!Array.isArray(raw)) return [];
  const out: ManualDepositPayment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const amountGross = readNum(o.amountGross) ?? 0;
    const paidAt = normalizeContractedAtToIso(
      o.paidAt != null ? String(o.paidAt) : null
    );
    const id = String(o.id ?? "").trim() || createManualDepositPaymentId();
    const note =
      o.note != null ? String(o.note).trim() || null : null;
    if (amountGross <= 0.009 && !paidAt) continue;
    out.push({
      id,
      paidAt,
      amountGross: roundMoney2(Math.max(0, amountGross)),
      note,
    });
  }
  return out.sort((a, b) => {
    const da = a.paidAt ?? "";
    const db = b.paidAt ?? "";
    if (da && db && da !== db) return da.localeCompare(db);
    return a.id.localeCompare(b.id);
  });
}

/** Součet ručních plateb zálohy, nebo legacy `paidDepositGross`. */
export function resolveManualDepositGross(manual: JobContractManualData): number {
  const payments = manual.manualDepositPayments ?? [];
  if (payments.length > 0) {
    return roundMoney2(
      payments.reduce((sum, p) => sum + Math.max(0, p.amountGross), 0)
    );
  }
  return roundMoney2(Math.max(0, Number(manual.paidDepositGross) || 0));
}

export function formatManualDepositPaymentLabel(
  payment: ManualDepositPayment,
  moneyFormatter: (value: number) => string = formatKcInline
): string {
  const dateLabel = payment.paidAt
    ? formatContractManualDateLabel(payment.paidAt)
    : "—";
  const amountLabel = moneyFormatter(payment.amountGross);
  const note = payment.note?.trim();
  if (note) return `${dateLabel} (${amountLabel}) · ${note}`;
  return `${dateLabel} (${amountLabel})`;
}

export function buildManualDepositPaymentLabels(
  payments: ManualDepositPayment[] | undefined,
  moneyFormatter?: (value: number) => string
): string[] {
  if (!payments?.length) return [];
  return payments
    .filter((p) => p.amountGross > 0.009)
    .map((p) => formatManualDepositPaymentLabel(p, moneyFormatter));
}

export function parseMoneyInput(value: string): number | null {
  const t = value.replace(/\s/g, "").replace(/\u00a0/g, "").replace(/Kč/gi, "").trim();
  if (!t || t === "—") return null;
  const normalized =
    t.includes(",") && !t.includes(".")
      ? t.replace(",", ".")
      : t.replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return roundMoney2(n);
}

export function formatMoneyInputDisplay(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "";
  const n = roundMoney2(Number(value));
  if (n === 0) return "0";
  return String(Math.round(n));
}

function readNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? roundMoney2(n) : null;
}

export function parseJobContractManual(job: unknown): JobContractManualData {
  const j = (job ?? {}) as Record<string, unknown>;
  const raw = j[JOB_CONTRACT_MANUAL_FIELD];
  const o =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const isContracted =
    o.isContracted === true ||
    j.isManuallyContracted === true ||
    j.manualContracted === true;

  const contractedAtRaw =
    o.contractedAt != null
      ? String(o.contractedAt).trim()
      : j.manualContractedAt != null
        ? String(j.manualContractedAt).trim()
        : "";
  const contractedAt = normalizeContractedAtToIso(contractedAtRaw);

  const contractNumber =
    (o.contractNumber != null ? String(o.contractNumber).trim() : "") ||
    (j.manualContractNumber != null ? String(j.manualContractNumber).trim() : "") ||
    null;

  const manualDepositPayments = parseManualDepositPayments(
    o.manualDepositPayments
  );

  const legacyPaid =
    readNum(o.paidDepositGross) ??
    readNum(j.manualPaidDepositGross) ??
    readNum(j.paidDepositManual);

  const data: JobContractManualData = {
    isContracted,
    contractedAt,
    contractNumber: contractNumber || null,
    totalPriceGross:
      readNum(o.totalPriceGross) ??
      readNum(j.manualContractTotalPriceGross) ??
      readNum(j.manualTotalPriceGross),
    requiredDepositGross:
      readNum(o.requiredDepositGross) ??
      readNum(j.manualRequiredDepositGross),
    paidDepositGross: legacyPaid,
    manualDepositPayments,
    depositNote:
      o.depositNote != null
        ? String(o.depositNote).trim() || null
        : j.manualDepositNote != null
          ? String(j.manualDepositNote).trim() || null
          : null,
  };

  if (manualDepositPayments.length > 0) {
    data.paidDepositGross = resolveManualDepositGross(data);
  }

  return data;
}

export function isJobManuallyContracted(job: unknown): boolean {
  return parseJobContractManual(job).isContracted === true;
}

/** Normalizuje vstup na ISO `YYYY-MM-DD` (uložení do Firestore). */
export function normalizeContractedAtToIso(
  raw: string | null | undefined
): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const isoPrefix = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoPrefix)) {
    return isoPrefix;
  }

  const czMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.replace(/\s/g, ""));
  if (czMatch) {
    const day = Number(czMatch[1]);
    const month = Number(czMatch[2]);
    const year = Number(czMatch[3]);
    if (
      year >= 1900 &&
      year <= 2100 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      const d = String(day).padStart(2, "0");
      const m = String(month).padStart(2, "0");
      return `${year}-${m}-${d}`;
    }
    return null;
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return null;
}

/** Zobrazení data zesmluvnění — český formát dd.mm.yyyy. */
export function formatContractManualDateLabel(iso: string | null | undefined): string {
  const normalized = normalizeContractedAtToIso(iso);
  if (!normalized) return "";
  const [y, m, d] = normalized.split("-");
  return `${d}.${m}.${y}`;
}

/** Parsování ručního vstupu data (ISO z date pickeru nebo dd.mm.yyyy). */
export function parseContractedAtInput(value: string): string | null {
  return normalizeContractedAtToIso(value);
}

function sanitizeManualDepositPaymentsForSave(
  payments: ManualDepositPayment[] | undefined
): ManualDepositPayment[] {
  if (!payments?.length) return [];
  const out: ManualDepositPayment[] = [];
  for (const p of payments) {
    const amountGross = roundMoney2(Math.max(0, Number(p.amountGross) || 0));
    const paidAt = normalizeContractedAtToIso(p.paidAt);
    if (amountGross <= 0.009 && !paidAt) continue;
    out.push({
      id: String(p.id ?? "").trim() || createManualDepositPaymentId(),
      paidAt,
      amountGross,
      note: p.note?.trim() || null,
    });
  }
  return out.sort((a, b) => {
    const da = a.paidAt ?? "";
    const db = b.paidAt ?? "";
    if (da && db && da !== db) return da.localeCompare(db);
    return a.id.localeCompare(b.id);
  });
}

export function serializeJobContractManualForFirestore(
  data: JobContractManualData
): Record<string, unknown> {
  const manualDepositPayments = sanitizeManualDepositPaymentsForSave(
    data.manualDepositPayments
  );
  const paidFromList =
    manualDepositPayments.length > 0
      ? roundMoney2(
          manualDepositPayments.reduce((s, p) => s + p.amountGross, 0)
        )
      : null;
  const paidDepositGross =
    paidFromList ??
    (data.paidDepositGross != null && Number.isFinite(data.paidDepositGross)
      ? roundMoney2(data.paidDepositGross)
      : null);

  return {
    isContracted: data.isContracted === true,
    contractedAt: normalizeContractedAtToIso(data.contractedAt) || null,
    contractNumber: data.contractNumber?.trim() || null,
    totalPriceGross:
      data.totalPriceGross != null && Number.isFinite(data.totalPriceGross)
        ? roundMoney2(data.totalPriceGross)
        : null,
    requiredDepositGross:
      data.requiredDepositGross != null && Number.isFinite(data.requiredDepositGross)
        ? roundMoney2(data.requiredDepositGross)
        : null,
    paidDepositGross,
    manualDepositPayments: manualDepositPayments.map((p) => ({
      id: p.id,
      paidAt: p.paidAt,
      amountGross: p.amountGross,
      note: p.note ?? null,
    })),
    depositNote: data.depositNote?.trim() || null,
  };
}
