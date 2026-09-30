"use client";

import { Search, RefreshCw, Loader2, Tags, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import type { LeadContactFilter } from "@/lib/lead-contact-status";
import {
  LEAD_DATE_PRESET_LABELS,
  formatLeadDateRangeLabel,
  type LeadDatePresetId,
  type LeadSortOrder,
  type LeadsFilterState,
} from "@/lib/leads/lead-filters";
import { cn } from "@/lib/utils";

type TagOption = { id?: string; name?: string };

type Props = {
  state: LeadsFilterState;
  onChange: (patch: Partial<LeadsFilterState>) => void;
  typOptions: string[];
  tags: TagOption[];
  canManageOffers: boolean;
  canManageTags: boolean;
  loading: boolean;
  onRefresh: () => void;
  onOpenTagsDialog: () => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  onApplyMobile?: () => void;
  className?: string;
};

const PRESET_ORDER: LeadDatePresetId[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
  "custom",
];

export function LeadsFiltersPanel(props: Props) {
  const s = props.state;
  const dateLabel = formatLeadDateRangeLabel(s.dateFrom, s.dateTo);

  const setPreset = (preset: LeadDatePresetId) => {
    if (preset === "custom") {
      props.onChange({ datePreset: "custom" });
      return;
    }
    props.onChange({ datePreset: preset });
  };

  return (
    <div className={cn("space-y-4", props.className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex-1 min-w-0 lg:min-w-[200px] space-y-1.5">
          <Label htmlFor="lead-search" className="text-xs text-slate-800">
            Vyhledávání
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-800" />
            <Input
              id="lead-search"
              className="pl-9"
              placeholder="Jméno, telefon, e-mail, adresa, typ, zpráva…"
              value={s.search}
              onChange={(e) => props.onChange({ search: e.target.value })}
            />
          </div>
        </div>

        <div className="w-full sm:w-[200px] space-y-1.5 shrink-0">
          <Label className="text-xs text-slate-800">Typ poptávky (ze zdroje)</Label>
          <select
            className={NATIVE_SELECT_CLASS}
            value={s.filterTyp}
            onChange={(e) => props.onChange({ filterTyp: e.target.value })}
          >
            <option value="">Všechny typy</option>
            {props.typOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="w-full sm:w-[220px] space-y-1.5 shrink-0">
          <Label className="text-xs text-slate-800">Štítek</Label>
          <select
            className={NATIVE_SELECT_CLASS}
            value={s.filterTag}
            onChange={(e) => props.onChange({ filterTag: e.target.value })}
          >
            <option value="">Všechny</option>
            <option value="__none__">Bez štítku</option>
            {props.tags.map((t) => (
              <option key={t.id} value={t.id!}>
                {t.name || t.id}
              </option>
            ))}
          </select>
        </div>

        {props.canManageOffers ? (
          <div className="w-full sm:w-[220px] space-y-1.5 shrink-0">
            <Label className="text-xs text-slate-800">Kontakt se zákazníkem</Label>
            <select
              className={NATIVE_SELECT_CLASS}
              value={s.filterContact}
              onChange={(e) =>
                props.onChange({ filterContact: e.target.value as LeadContactFilter })
              }
            >
              <option value="">Všechny</option>
              <option value="uncontacted">Neukontaktované</option>
              <option value="contacted">Kontaktované</option>
              <option value="offer_sent">Nabídka odeslána</option>
            </select>
          </div>
        ) : null}

        <div className="w-full sm:w-[200px] space-y-1.5 shrink-0">
          <Label className="text-xs text-slate-800">Řazení podle data přijetí</Label>
          <select
            className={NATIVE_SELECT_CLASS}
            value={s.sortOrder}
            onChange={(e) => props.onChange({ sortOrder: e.target.value as LeadSortOrder })}
          >
            <option value="newest">Nejnovější nahoře</option>
            <option value="oldest">Nejstarší nahoře</option>
          </select>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <Label className="text-xs text-slate-800">Datum přijetí</Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto">
            <span className="text-xs text-slate-600 shrink-0">Od</span>
            <Input
              type="date"
              className="w-full sm:w-[160px]"
              value={s.dateFrom}
              onChange={(e) =>
                props.onChange({
                  dateFrom: e.target.value,
                  datePreset: e.target.value || s.dateTo ? "custom" : "",
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto">
            <span className="text-xs text-slate-600 shrink-0">Do</span>
            <Input
              type="date"
              className="w-full sm:w-[160px]"
              value={s.dateTo}
              onChange={(e) =>
                props.onChange({
                  dateTo: e.target.value,
                  datePreset: s.dateFrom || e.target.value ? "custom" : "",
                })
              }
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_ORDER.map((id) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={s.datePreset === id ? "secondary" : "outline"}
              className="h-8 text-xs"
              onClick={() => setPreset(id)}
            >
              {LEAD_DATE_PRESET_LABELS[id]}
            </Button>
          ))}
        </div>
      </div>

      {(dateLabel || props.hasActiveFilters) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {dateLabel ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-slate-800">
              Datum: {dateLabel}
              <button
                type="button"
                className="rounded p-0.5 hover:bg-slate-200"
                aria-label="Odstranit filtr data"
                onClick={() =>
                  props.onChange({ dateFrom: "", dateTo: "", datePreset: "" })
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : null}
          {props.hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={props.onClearFilters}
            >
              Vymazat filtry
            </Button>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="gap-2 min-h-[44px]"
          onClick={() => props.onRefresh()}
          disabled={props.loading}
        >
          {props.loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Obnovit
        </Button>
        {props.canManageTags ? (
          <Button
            type="button"
            variant="secondary"
            className="gap-2 min-h-[44px]"
            onClick={props.onOpenTagsDialog}
          >
            <Tags className="h-4 w-4" />
            Správa štítků
          </Button>
        ) : null}
        {props.onApplyMobile ? (
          <Button type="button" className="min-h-[44px] flex-1 sm:flex-none" onClick={props.onApplyMobile}>
            Použít filtry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
