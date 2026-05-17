/**
 * Ruční údaje smlouvy a zálohy na dokumentu zakázky (companies/{id}/jobs/{id}.contractManual).
 */

import { roundMoney2 } from "@/lib/vat-calculations";

export const JOB_CONTRACT_MANUAL_FIELD = "contractManual" as const;

export type JobContractManualData = {
  isContracted?: boolean;
  /** ISO datum YYYY-MM-DD */
  contractedAt?: string | null;
  contractNumber?: string | null;
  totalPriceGross?: number | null;
  requiredDepositGross?: number | null;
  paidDepositGross?: number | null;
  depositNote?: string | null;
};

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

  const contractedAt =
    o.contractedAt != null
      ? String(o.contractedAt).trim().slice(0, 10) || null
      : j.manualContractedAt != null
        ? String(j.manualContractedAt).trim().slice(0, 10) || null
        : null;

  const contractNumber =
    (o.contractNumber != null ? String(o.contractNumber).trim() : "") ||
    (j.manualContractNumber != null ? String(j.manualContractNumber).trim() : "") ||
    null;

  return {
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
    paidDepositGross:
      readNum(o.paidDepositGross) ??
      readNum(j.manualPaidDepositGross) ??
      readNum(j.paidDepositManual),
    depositNote:
      o.depositNote != null
        ? String(o.depositNote).trim() || null
        : j.manualDepositNote != null
          ? String(j.manualDepositNote).trim() || null
          : null,
  };
}

export function isJobManuallyContracted(job: unknown): boolean {
  return parseJobContractManual(job).isContracted === true;
}

export function formatContractManualDateLabel(iso: string | null | undefined): string {
  const s = String(iso ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [y, m, d] = s.split("-");
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

export function serializeJobContractManualForFirestore(
  data: JobContractManualData
): Record<string, unknown> {
  return {
    isContracted: data.isContracted === true,
    contractedAt: data.contractedAt?.trim() || null,
    contractNumber: data.contractNumber?.trim() || null,
    totalPriceGross:
      data.totalPriceGross != null && Number.isFinite(data.totalPriceGross)
        ? roundMoney2(data.totalPriceGross)
        : null,
    requiredDepositGross:
      data.requiredDepositGross != null && Number.isFinite(data.requiredDepositGross)
        ? roundMoney2(data.requiredDepositGross)
        : null,
    paidDepositGross:
      data.paidDepositGross != null && Number.isFinite(data.paidDepositGross)
        ? roundMoney2(data.paidDepositGross)
        : null,
    depositNote: data.depositNote?.trim() || null,
  };
}
