"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import type { OrgLicenseFilter } from "@/lib/platform-org-campaigns/recipient-resolver";

export type OrgPickerRow = {
  id: string;
  name: string;
  ico: string | null;
  email: string | null;
  licenseStatus: string;
  hasValidEmail: boolean;
  marketingUnsubscribed?: boolean;
};

type Props = {
  selectedIds: string[];
  onChangeSelectedIds: (ids: string[]) => void;
  emailMarketing: boolean;
  disabled?: boolean;
};

const LICENSE_FILTERS: { value: OrgLicenseFilter; label: string }[] = [
  { value: "all", label: "Všechny licence" },
  { value: "active", label: "Aktivní licence" },
  { value: "trial", label: "Trial" },
  { value: "inactive", label: "Neaktivní" },
];

export function OrgCampaignRecipientPicker(props: Props) {
  const { selectedIds, onChangeSelectedIds, emailMarketing, disabled } = props;
  const [search, setSearch] = useState("");
  const [licenseFilter, setLicenseFilter] = useState<OrgLicenseFilter>("all");
  const [rows, setRows] = useState<OrgPickerRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({
        search,
        licenseFilter,
        emailMarketing: emailMarketing ? "true" : "false",
        mode: "all",
      });
      const res = await fetch(`/api/superadmin/org-campaigns/organization-options?${q}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();
      if (data.ok) setRows(data.organizations ?? []);
    } finally {
      setLoading(false);
    }
  }, [search, licenseFilter, emailMarketing]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const visibleIds = rows.map((r) => r.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  const targetEmails = useMemo(() => {
    const emails = new Set<string>();
    for (const r of rows) {
      if (!selectedSet.has(r.id)) continue;
      if (r.email) emails.add(r.email);
    }
    return [...emails];
  }, [rows, selectedSet]);

  const missingEmailCount = useMemo(
    () => rows.filter((r) => selectedSet.has(r.id) && !r.hasValidEmail).length,
    [rows, selectedSet]
  );

  function toggle(id: string) {
    if (selectedSet.has(id)) {
      onChangeSelectedIds(selectedIds.filter((x) => x !== id));
    } else {
      onChangeSelectedIds([...selectedIds, id]);
    }
  }

  function selectAllVisible() {
    const merged = new Set([...selectedIds, ...visibleIds]);
    onChangeSelectedIds([...merged]);
  }

  function clearSelection() {
    onChangeSelectedIds([]);
  }

  return (
    <div className="space-y-3 rounded-md border p-3 bg-muted/10">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[180px] space-y-1">
          <Label>Hledat (název, IČO, e-mail, ID)</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="např. 12345678 nebo firma@…"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label>Licence</Label>
          <select
            className="flex h-10 rounded-md border bg-background px-3 text-sm"
            value={licenseFilter}
            onChange={(e) => setLicenseFilter(e.target.value as OrgLicenseFilter)}
            disabled={disabled}
          >
            {LICENSE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Button type="button" size="sm" variant="outline" disabled={disabled || loading} onClick={selectAllVisible}>
          Vybrat vše (zobrazené)
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || !selectedIds.length} onClick={clearSelection}>
          Zrušit výběr
        </Button>
        <span className="self-center text-muted-foreground">
          Vybráno: <strong>{selectedIds.length}</strong> · cílové e-maily: <strong>{targetEmails.length}</strong>
        </span>
      </div>

      {missingEmailCount > 0 ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          {missingEmailCount} vybraných organizací nemá platný kontaktní e-mail — u nich se e-mail neodešle.
        </p>
      ) : null}

      <div className="max-h-64 overflow-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 border-b">
            <tr>
              <th className="p-2 w-10">Výběr</th>
              <th className="p-2 text-left">Organizace</th>
              <th className="p-2 text-left hidden sm:table-cell">IČO</th>
              <th className="p-2 text-left hidden md:table-cell">E-mail</th>
              <th className="p-2 text-left">Licence</th>
              <th className="p-2 text-left hidden lg:table-cell">Stav</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-4 text-center">
                  <Loader2 className="h-5 w-5 animate-spin inline" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-muted-foreground">
                  Žádné organizace nevyhovují filtru.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50/80">
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(r.id)}
                      onChange={() => toggle(r.id)}
                      disabled={disabled}
                      aria-label={`Vybrat ${r.name}`}
                    />
                  </td>
                  <td className="p-2 font-medium">{r.name}</td>
                  <td className="p-2 hidden sm:table-cell text-muted-foreground">{r.ico ?? "—"}</td>
                  <td className="p-2 hidden md:table-cell truncate max-w-[180px]">{r.email ?? "—"}</td>
                  <td className="p-2 capitalize">{r.licenseStatus}</td>
                  <td className="p-2 hidden lg:table-cell text-xs">
                    {!r.hasValidEmail ? "bez e-mailu" : r.marketingUnsubscribed ? "odhlášen marketing" : "OK"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {targetEmails.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Zobrazit cílové e-mailové adresy ({targetEmails.length})</summary>
          <p className="mt-1 break-all">{targetEmails.join(", ")}</p>
        </details>
      ) : null}

      {allVisibleSelected && rows.length >= 400 ? (
        <p className="text-xs text-muted-foreground">Seznam může být omezen — zpřesněte vyhledáváním.</p>
      ) : null}
    </div>
  );
}
