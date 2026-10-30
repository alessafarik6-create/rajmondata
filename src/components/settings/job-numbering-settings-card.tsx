"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import type { JobNumberingSettings, JobNumberingTypeRule } from "@/lib/jobs/job-numbering";
import { formatPresetPrefixSeq } from "@/lib/jobs/job-numbering";
import { Loader2 } from "lucide-react";

type Props = {
  companyId: string;
  canManage: boolean;
};

export function JobNumberingSettingsCard({ companyId, canManage }: Props) {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<JobNumberingSettings | null>(null);
  const [previews, setPreviews] = useState<
    Record<string, { lastAssigned: string | null; nextPreview: string }>
  >({});

  const load = useCallback(async () => {
    if (!user || !companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/jobs/job-numbering-settings?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        settings?: JobNumberingSettings;
        previews?: typeof previews;
      };
      if (data.ok && data.settings) {
        setSettings(data.settings);
        setPreviews(data.previews ?? {});
      }
    } finally {
      setLoading(false);
    }
  }, [user, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!user || !settings || !canManage) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/jobs/job-numbering-settings", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ companyId, settings }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Uložení selhalo.");
      toast({ title: "Číslování zakázek uloženo" });
      void load();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení selhalo",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const runMigration = async (dryRun: boolean) => {
    if (!user || !canManage) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/jobs/migrate-job-numbers?companyId=${encodeURIComponent(companyId)}&dryRun=${dryRun ? "1" : "0"}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        count?: number;
        rows?: { jobId: string; assignedJobNumber: string }[];
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Migrace selhala.");
      toast({
        title: dryRun ? "Kontrolní náhled migrace" : "Migrace dokončena",
        description: `${data.count ?? 0} zakázek${dryRun ? " (bez zápisu)" : ""}`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Migrace",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const updateType = (id: string, patch: Partial<JobNumberingTypeRule>) => {
    setSettings((s) => {
      if (!s) return s;
      return {
        ...s,
        types: s.types.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      };
    });
  };

  if (loading || !settings) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
        </CardContent>
      </Card>
    );
  }

  const setDefaultTypeId = (id: string) => {
    setSettings((s) => (s ? { ...s, defaultTypeId: id } : s));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Číselné řady</CardTitle>
        <CardDescription>
          Evidenční čísla zakázek (např. RD0001, M0001). Změna předpony nemění již přidělená čísla.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            checked={settings.resetYearly}
            disabled={!canManage}
            onCheckedChange={(v) => setSettings({ ...settings, resetYearly: v })}
          />
          <Label>Roční číslování (reset sekvence každý rok)</Label>
        </div>

        <div className="space-y-3">
          {settings.types.map((t) => {
            const seqMatch = t.format.match(/\{SEQ:(\d+)\}/i);
            const digitWidth = seqMatch ? seqMatch[1] : "4";
            const isDefault = settings.defaultTypeId === t.id;
            return (
              <div key={t.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t.name || t.id}</p>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={t.active !== false}
                        disabled={!canManage}
                        onCheckedChange={(v) =>
                          updateType(t.id, { active: v ? undefined : false })
                        }
                      />
                      <Label className="text-xs">Aktivní</Label>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="default-numbering-series"
                        checked={isDefault}
                        disabled={!canManage}
                        onChange={() => setDefaultTypeId(t.id)}
                      />
                      Výchozí řada
                    </label>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <div>
                    <Label className="text-xs">Název řady</Label>
                    <Input
                      value={t.name}
                      disabled={!canManage}
                      onChange={(e) => updateType(t.id, { name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Předpona</Label>
                    <Input
                      value={t.prefix}
                      disabled={!canManage}
                      onChange={(e) =>
                        updateType(t.id, { prefix: e.target.value.toUpperCase() })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Počet číslic</Label>
                    <Input
                      type="number"
                      min={1}
                      max={8}
                      value={digitWidth}
                      disabled={!canManage}
                      onChange={(e) => {
                        const d = Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 4));
                        updateType(t.id, { format: formatPresetPrefixSeq(t.prefix, d) });
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Počáteční číslo</Label>
                    <Input
                      type="number"
                      min={1}
                      value={t.startSequence ?? 1}
                      disabled={!canManage}
                      onChange={(e) =>
                        updateType(t.id, {
                          startSequence: Math.max(1, parseInt(e.target.value, 10) || 1),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Formát (pokročilé)</Label>
                    <Input
                      value={t.format}
                      disabled={!canManage}
                      onChange={(e) => updateType(t.id, { format: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Typ zakázky / štítek</Label>
                    <Input
                      value={t.jobTagMatch ?? ""}
                      disabled={!canManage}
                      placeholder="např. montá"
                      onChange={(e) =>
                        updateType(t.id, { jobTagMatch: e.target.value || undefined })
                      }
                    />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Další volné číslo:{" "}
                  <span className="font-mono font-semibold text-slate-800">
                    {previews[t.id]?.nextPreview ?? "—"}
                  </span>
                  {previews[t.id]?.lastAssigned ? (
                    <span className="ml-2">Poslední přidělené: {previews[t.id]?.lastAssigned}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="bg-orange-600 hover:bg-orange-700"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Ukládám…" : "Uložit nastavení"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void runMigration(true)}>
              Kontrola migrace (bez zápisu)
            </Button>
            <Button type="button" variant="outline" onClick={() => void runMigration(false)}>
              Doplnit čísla stávajícím zakázkám
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
