/**
 * Centrální mapování stavů zakázek — label, barvy, ikony, pořadí, filtry.
 */

import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  CircleDot,
  Clock3,
  PauseCircle,
  Receipt,
  Wrench,
  XCircle,
} from "lucide-react";

/** Kanonické hodnoty uložené ve Firestore (`jobs.status`). */
export type JobStatusValue =
  | "nová"
  | "rozpracovaná"
  | "čeká"
  | "pozastavená"
  | "dokončená"
  | "fakturována"
  | "zrušená";

export type JobStatusFilterKey =
  | "active"
  | "all"
  | "new"
  | "in_progress"
  | "waiting"
  | "paused"
  | "completed"
  | "cancelled";

export type JobListSortKey =
  | "smart"
  | "activity"
  | "created"
  | "deadline"
  | "name"
  | "customer"
  | "status";

export type JobDeadlineFilterKey = "overdue" | "none" | "completed_month";

export type JobStatusConfig = {
  value: JobStatusValue;
  label: string;
  /** Pořadí pro řazení a smart sort (nižší = dříve). */
  sortOrder: number;
  /** Tailwind třídy pro badge (desktop i mobil). */
  badgeClassName: string;
  /** Pozadí řádku v tabulce (volitelné). */
  rowClassName?: string;
  icon: LucideIcon;
  filterGroup: JobStatusFilterKey | "terminal";
};

const JOB_STATUS_CONFIGS: JobStatusConfig[] = [
  {
    value: "nová",
    label: "Nová",
    sortOrder: 20,
    badgeClassName:
      "border-blue-500/30 bg-blue-500/10 text-blue-800 dark:text-blue-200",
    icon: CircleDot,
    filterGroup: "new",
  },
  {
    value: "rozpracovaná",
    label: "Rozpracovaná",
    sortOrder: 10,
    badgeClassName:
      "border-orange-500/35 bg-orange-500/15 text-orange-800 dark:text-orange-200",
    icon: Wrench,
    filterGroup: "in_progress",
  },
  {
    value: "čeká",
    label: "Čekající",
    sortOrder: 30,
    badgeClassName:
      "border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-100",
    icon: Clock3,
    filterGroup: "waiting",
  },
  {
    value: "pozastavená",
    label: "Pozastavená",
    sortOrder: 40,
    badgeClassName:
      "border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-200",
    icon: PauseCircle,
    filterGroup: "paused",
  },
  {
    value: "dokončená",
    label: "Dokončená",
    sortOrder: 100,
    badgeClassName:
      "border-emerald-500/35 bg-emerald-500/15 text-emerald-800 dark:text-emerald-100",
    rowClassName: "bg-emerald-500/[0.06] hover:bg-emerald-500/10",
    icon: CheckCircle2,
    filterGroup: "completed",
  },
  {
    value: "fakturována",
    label: "Fakturována",
    sortOrder: 110,
    badgeClassName:
      "border-emerald-600/35 bg-emerald-600/20 text-emerald-900 dark:text-emerald-100",
    rowClassName: "bg-emerald-500/[0.06] hover:bg-emerald-500/10",
    icon: Receipt,
    filterGroup: "completed",
  },
  {
    value: "zrušená",
    label: "Zrušená",
    sortOrder: 120,
    badgeClassName:
      "border-red-500/35 bg-red-500/10 text-red-800 dark:text-red-200",
    icon: XCircle,
    filterGroup: "cancelled",
  },
];

const STATUS_BY_VALUE = new Map<string, JobStatusConfig>(
  JOB_STATUS_CONFIGS.map((c) => [c.value, c])
);

const ACTIVE_FILTER_KEYS = new Set<JobStatusFilterKey>([
  "new",
  "in_progress",
  "waiting",
  "paused",
]);

export const JOB_STATUS_FILTER_OPTIONS: {
  key: JobStatusFilterKey;
  label: string;
}[] = [
  { key: "active", label: "Aktivní" },
  { key: "all", label: "Všechny" },
  { key: "new", label: "Nové" },
  { key: "in_progress", label: "Rozpracované" },
  { key: "waiting", label: "Čekající" },
  { key: "paused", label: "Pozastavené" },
  { key: "completed", label: "Dokončené" },
  { key: "cancelled", label: "Zrušené" },
];

export const JOB_LIST_SORT_OPTIONS: { key: JobListSortKey; label: string }[] = [
  { key: "smart", label: "Doporučené (termín + stav)" },
  { key: "activity", label: "Poslední aktivita" },
  { key: "created", label: "Datum vytvoření" },
  { key: "deadline", label: "Termín" },
  { key: "name", label: "Název" },
  { key: "customer", label: "Zákazník" },
  { key: "status", label: "Stav" },
];

export const DEFAULT_JOB_STATUS_FILTER: JobStatusFilterKey = "active";
export const DEFAULT_JOB_LIST_SORT: JobListSortKey = "smart";

export function normalizeJobStatusValue(
  status: string | undefined | null
): JobStatusValue | string {
  const raw = String(status ?? "").trim().toLowerCase();
  if (!raw) return "nová";
  if (STATUS_BY_VALUE.has(raw)) return raw as JobStatusValue;
  return raw;
}

export function getJobStatusConfig(
  status: string | undefined | null
): JobStatusConfig {
  const key = normalizeJobStatusValue(status);
  return (
    STATUS_BY_VALUE.get(String(key)) ?? {
      value: String(key) as JobStatusValue,
      label: String(key) || "—",
      sortOrder: 999,
      badgeClassName: "border-border bg-muted text-muted-foreground",
      icon: CircleDot,
      filterGroup: "terminal",
    }
  );
}

export function jobStatusLabel(status: string | undefined | null): string {
  return getJobStatusConfig(status).label;
}

export function isActiveJobStatus(status: string | undefined | null): boolean {
  const cfg = getJobStatusConfig(status);
  return ACTIVE_FILTER_KEYS.has(cfg.filterGroup as JobStatusFilterKey);
}

export function isCompletedJobStatus(status: string | undefined | null): boolean {
  const cfg = getJobStatusConfig(status);
  return cfg.filterGroup === "completed";
}

export function isCancelledJobStatus(status: string | undefined | null): boolean {
  return getJobStatusConfig(status).filterGroup === "cancelled";
}

export function jobMatchesStatusFilter(
  status: string | undefined | null,
  filter: JobStatusFilterKey
): boolean {
  const cfg = getJobStatusConfig(status);
  switch (filter) {
    case "all":
      return true;
    case "active":
      return isActiveJobStatus(status);
    case "new":
    case "in_progress":
    case "waiting":
    case "paused":
    case "completed":
    case "cancelled":
      return cfg.filterGroup === filter;
    default:
      return true;
  }
}

export function parseJobStatusFilterParam(
  raw: string | null | undefined
): JobStatusFilterKey {
  const v = String(raw ?? "").trim().toLowerCase();
  const allowed = JOB_STATUS_FILTER_OPTIONS.map((o) => o.key);
  if (allowed.includes(v as JobStatusFilterKey)) {
    return v as JobStatusFilterKey;
  }
  return DEFAULT_JOB_STATUS_FILTER;
}

export function parseJobListSortParam(
  raw: string | null | undefined
): JobListSortKey {
  const v = String(raw ?? "").trim().toLowerCase();
  const allowed = JOB_LIST_SORT_OPTIONS.map((o) => o.key);
  if (allowed.includes(v as JobListSortKey)) {
    return v as JobListSortKey;
  }
  return DEFAULT_JOB_LIST_SORT;
}

export function parseJobDeadlineFilterParam(
  raw: string | null | undefined
): JobDeadlineFilterKey | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "overdue" || v === "none" || v === "completed_month") {
    return v;
  }
  return null;
}

/** Položky pro Select ve formulářích (detail, editace). */
export function jobStatusSelectOptions(): { value: JobStatusValue; label: string }[] {
  return JOB_STATUS_CONFIGS.map((c) => ({ value: c.value, label: c.label }));
}

export function countJobsByStatusFilter<T extends { status?: string }>(
  jobs: T[],
  filter: JobStatusFilterKey
): number {
  return jobs.filter((j) => jobMatchesStatusFilter(j.status, filter)).length;
}
