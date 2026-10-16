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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Číslování zakázek</CardTitle>
        <CardDescription>
          Předpony a formát čísel podle typu zakázky. Nové zakázky dostanou číslo automaticky.
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
          {settings.types.map((t) => (
            <div key={t.id} className="rounded-lg border p-3 space-y-2">
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Název typu</Label>
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
                    onChange={(e) => updateType(t.id, { prefix: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Formát</Label>
                  <Input
                    value={t.format}
                    disabled={!canManage}
                    onChange={(e) => updateType(t.id, { format: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Shoda se štítkem (volitelné)</Label>
                  <Input
                    value={t.jobTagMatch ?? ""}
                    disabled={!canManage}
                    placeholder="např. pergol"
                    onChange={(e) => updateType(t.id, { jobTagMatch: e.target.value || undefined })}
                  />
                </div>
                <div className="text-xs text-muted-foreground self-end pb-2">
                  Další číslo:{" "}
                  <span className="font-mono font-semibold text-slate-800">
                    {previews[t.id]?.nextPreview ?? "—"}
                  </span>
                  {previews[t.id]?.lastAssigned ? (
                    <span className="block">Poslední: {previews[t.id]?.lastAssigned}</span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
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
