import {
  addDays,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { cs } from "date-fns/locale";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import type { LeadContactFilter } from "@/lib/lead-contact-status";
import { leadReceivedYmd, ymdInLeadsTimezone } from "@/lib/leads/lead-received-date";
import type { LeadOverlayReceivedFields } from "@/lib/leads/lead-received-date";

export type LeadSortOrder = "newest" | "oldest";

export type LeadDatePresetId =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_7_days"
  | "last_30_days"
  | "this_year"
  | "custom";

export const LEAD_DATE_PRESET_LABELS: Record<LeadDatePresetId, string> = {
  today: "Dnes",
  yesterday: "Včera",
  this_week: "Tento týden",
  last_week: "Minulý týden",
  this_month: "Tento měsíc",
  last_month: "Minulý měsíc",
  last_7_days: "Posledních 7 dní",
  last_30_days: "Posledních 30 dní",
  this_year: "Tento rok",
  custom: "Vlastní období",
};

export type LeadsFilterState = {
  search: string;
  filterTyp: string;
  filterTag: string;
  filterContact: LeadContactFilter;
  sortOrder: LeadSortOrder;
  dateFrom: string;
  dateTo: string;
  datePreset: LeadDatePresetId | "";
};

export function defaultLeadsFilterState(): LeadsFilterState {
  return {
    search: "",
    filterTyp: "",
    filterTag: "",
    filterContact: "",
    sortOrder: "newest",
    dateFrom: "",
    dateTo: "",
    datePreset: "",
  };
}

export function leadsFilterStateHasActive(state: LeadsFilterState): boolean {
  return Boolean(
    state.search.trim() ||
      state.filterTyp ||
      state.filterTag ||
      state.filterContact ||
      state.dateFrom ||
      state.dateTo ||
      state.datePreset
  );
}

export function computeLeadDatePresetRange(
  preset: LeadDatePresetId,
  now: Date = new Date()
): { dateFrom: string; dateTo: string } {
  const today = ymdInLeadsTimezone(now);

  switch (preset) {
    case "today":
      return { dateFrom: today, dateTo: today };
    case "yesterday": {
      const y = ymdInLeadsTimezone(subDays(now, 1));
      return { dateFrom: y, dateTo: y };
    }
    case "this_week": {
      const start = startOfWeek(now, { locale: cs, weekStartsOn: 1 });
      const end = endOfWeek(now, { locale: cs, weekStartsOn: 1 });
      return { dateFrom: ymdInLeadsTimezone(start), dateTo: ymdInLeadsTimezone(end) };
    }
    case "last_week": {
      const prev = subWeeks(now, 1);
      const start = startOfWeek(prev, { locale: cs, weekStartsOn: 1 });
      const end = endOfWeek(prev, { locale: cs, weekStartsOn: 1 });
      return { dateFrom: ymdInLeadsTimezone(start), dateTo: ymdInLeadsTimezone(end) };
    }
    case "this_month": {
      const start = startOfMonth(now);
      return { dateFrom: ymdInLeadsTimezone(start), dateTo: today };
    }
    case "last_month": {
      const prev = subMonths(now, 1);
      const start = startOfMonth(prev);
      const end = endOfMonth(prev);
      return { dateFrom: ymdInLeadsTimezone(start), dateTo: ymdInLeadsTimezone(end) };
    }
    case "last_7_days": {
      const start = subDays(now, 6);
      return { dateFrom: ymdInLeadsTimezone(start), dateTo: today };
    }
    case "last_30_days": {
      const start = subDays(now, 29);
      return { dateFrom: ymdInLeadsTimezone(start), dateTo: today };
    }
    case "this_year": {
      const start = startOfYear(now);
      return { dateFrom: ymdInLeadsTimezone(start), dateTo: today };
    }
    case "custom":
    default:
      return { dateFrom: "", dateTo: "" };
  }
}

/** Porovnání kalendářního dne v Prague TZ — „Do“ zahrnuje celý den. */
export function leadMatchesDateRange(
  lead: LeadImportRow,
  ov: LeadOverlayReceivedFields | undefined,
  dateFrom: string,
  dateTo: string
): boolean {
  const from = dateFrom.trim();
  const to = dateTo.trim();
  if (!from && !to) return true;

  const ymd = leadReceivedYmd(lead, ov);
  if (!ymd) return false;

  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

const PRESET_IDS = new Set<string>(Object.keys(LEAD_DATE_PRESET_LABELS));

function isLeadDatePreset(v: string): v is LeadDatePresetId {
  return PRESET_IDS.has(v);
}

export function parseLeadsFiltersFromSearchParams(params: URLSearchParams): LeadsFilterState {
  const base = defaultLeadsFilterState();
  const search = params.get("q") ?? params.get("search") ?? "";
  const filterTyp = params.get("typ") ?? "";
  const filterTag = params.get("tag") ?? "";
  const contact = params.get("contact") ?? "";
  const sort = params.get("sort") ?? "";
  const dateFrom = params.get("dateFrom") ?? "";
  const dateTo = params.get("dateTo") ?? "";
  const presetRaw = params.get("datePreset") ?? "";

  base.search = search;
  base.filterTyp = filterTyp;
  base.filterTag = filterTag;
  if (contact === "uncontacted" || contact === "contacted" || contact === "offer_sent") {
    base.filterContact = contact;
  }
  if (sort === "oldest" || sort === "newest") {
    base.sortOrder = sort;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) base.dateFrom = dateFrom;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) base.dateTo = dateTo;
  if (isLeadDatePreset(presetRaw)) base.datePreset = presetRaw;

  return base;
}

export function buildLeadsFilterSearchParams(state: LeadsFilterState): URLSearchParams {
  const q = new URLSearchParams();
  const s = state.search.trim();
  if (s) q.set("q", s);
  if (state.filterTyp) q.set("typ", state.filterTyp);
  if (state.filterTag) q.set("tag", state.filterTag);
  if (state.filterContact) q.set("contact", state.filterContact);
  if (state.sortOrder && state.sortOrder !== "newest") q.set("sort", state.sortOrder);
  if (state.dateFrom) q.set("dateFrom", state.dateFrom);
  if (state.dateTo) q.set("dateTo", state.dateTo);
  if (state.datePreset) q.set("datePreset", state.datePreset);
  return q;
}

export function formatLeadDateRangeLabel(dateFrom: string, dateTo: string): string | null {
  const from = dateFrom.trim();
  const to = dateTo.trim();
  if (!from && !to) return null;

  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    if (!y || !m || !d) return ymd;
    return `${d}. ${m}. ${y}`;
  };

  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (from) return `od ${fmt(from)}`;
  return `do ${fmt(to)}`;
}

/** Pro export / API — stejná logika bez overlay (pouze receivedAtIso). */
export function leadMatchesDateRangeIsoOnly(
  lead: LeadImportRow,
  dateFrom: string,
  dateTo: string
): boolean {
  return leadMatchesDateRange(lead, undefined, dateFrom, dateTo);
}
