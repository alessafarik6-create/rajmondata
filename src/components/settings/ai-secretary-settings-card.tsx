"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useUser } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { AiSecretarySettingsDoc } from "@/lib/ai/secretary/settings";

type Props = { companyId: string };

export function AiSecretarySettingsCard({ companyId }: Props) {
  const { user } = useUser();
  const { toast } = useToast();
  const [settings, setSettings] = useState<AiSecretarySettingsDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user || !companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/ai/secretary/settings?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (json.ok) setSettings(json.settings);
    } finally {
      setLoading(false);
    }
  }, [user, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!user || !settings) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/ai/secretary/settings", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ companyId, settings }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast({ title: "Uloženo", description: "Nastavení AI sekretářky." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení selhalo.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  const mod = settings.modules;

  const row = (
    key: keyof AiSecretarySettingsDoc["modules"],
    title: string,
    implemented: boolean,
    extra?: ReactNode
  ) => (
    <div className={`rounded-lg border p-3 space-y-2 ${!implemented ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <Switch
          disabled={!implemented}
          checked={mod[key].enabled}
          onCheckedChange={(v) =>
            setSettings({
              ...settings,
              modules: { ...mod, [key]: { ...mod[key], enabled: v } },
            })
          }
        />
      </div>
      {implemented && mod[key].enabled ? extra : null}
      {!implemented ? (
        <p className="text-xs text-muted-foreground">Modul zatím není v sekretářce implementován.</p>
      ) : null}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nastavení AI sekretářky</CardTitle>
        <CardDescription>
          Které moduly smí hlasová sekretářka používat. Nová relace načte jen povolené nástroje.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>Sekretářka zapnuta</Label>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(v) => setSettings({ ...settings, enabled: v })}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {row(
            "calendar",
            "Kalendář a schůzky",
            true,
            <>
              <ToggleRow label="Číst" checked={mod.calendar.read} onChange={(v) => setSettings({ ...settings, modules: { ...mod, calendar: { ...mod.calendar, read: v } } })} />
              <ToggleRow label="Vytvářet" checked={mod.calendar.create} onChange={(v) => setSettings({ ...settings, modules: { ...mod, calendar: { ...mod.calendar, create: v } } })} />
              <ToggleRow label="Měnit" checked={mod.calendar.update} onChange={(v) => setSettings({ ...settings, modules: { ...mod, calendar: { ...mod.calendar, update: v } } })} />
              <ToggleRow label="Rušit" checked={mod.calendar.delete} onChange={(v) => setSettings({ ...settings, modules: { ...mod, calendar: { ...mod.calendar, delete: v } } })} />
            </>
          )}
          {row(
            "tasks",
            "Úkoly",
            true,
            <>
              <ToggleRow label="Číst" checked={mod.tasks.read} onChange={(v) => setSettings({ ...settings, modules: { ...mod, tasks: { ...mod.tasks, read: v } } })} />
              <ToggleRow label="Vytvářet" checked={mod.tasks.create} onChange={(v) => setSettings({ ...settings, modules: { ...mod, tasks: { ...mod.tasks, create: v } } })} />
              <ToggleRow label="Měnit" checked={mod.tasks.update} onChange={(v) => setSettings({ ...settings, modules: { ...mod, tasks: { ...mod.tasks, update: v } } })} />
              <ToggleRow label="Rušit" checked={mod.tasks.delete} onChange={(v) => setSettings({ ...settings, modules: { ...mod, tasks: { ...mod.tasks, delete: v } } })} />
            </>
          )}
          {row(
            "email",
            "E-maily",
            true,
            <>
              <ToggleRow label="Číst" checked={mod.email.read} onChange={(v) => setSettings({ ...settings, modules: { ...mod, email: { ...mod.email, read: v } } })} />
              <ToggleRow label="Připravit odpověď" checked={mod.email.draft} onChange={(v) => setSettings({ ...settings, modules: { ...mod, email: { ...mod.email, draft: v } } })} />
              <ToggleRow label="Odesílat po potvrzení" checked={mod.email.send} onChange={(v) => setSettings({ ...settings, modules: { ...mod, email: { ...mod.email, send: v } } })} />
            </>
          )}
          {row(
            "jobs",
            "Zakázky",
            true,
            <>
              <ToggleRow label="Číst" checked={mod.jobs.read} onChange={(v) => setSettings({ ...settings, modules: { ...mod, jobs: { ...mod.jobs, read: v } } })} />
              <ToggleRow label="Otevírat detail" checked={mod.jobs.open} onChange={(v) => setSettings({ ...settings, modules: { ...mod, jobs: { ...mod.jobs, open: v } } })} />
              <ToggleRow label="Měnit" checked={mod.jobs.write} onChange={(v) => setSettings({ ...settings, modules: { ...mod, jobs: { ...mod.jobs, write: v } } })} />
            </>
          )}
          {row("customers", "Zákazníci", false)}
          {row("offers", "Nabídky", false)}
          {row("inquiries", "Poptávky", false)}
          {row("invoices", "Faktury a doklady", false)}
          {row("bank", "Banka", false)}
          {row("warehouse", "Sklad", false)}
          {row(
            "aiMemory",
            "Paměť a naučené postupy",
            true,
            <>
              <ToggleRow label="Číst" checked={mod.aiMemory.read} onChange={(v) => setSettings({ ...settings, modules: { ...mod, aiMemory: { ...mod.aiMemory, read: v } } })} />
              <ToggleRow label="Ukládat (s potvrzením)" checked={mod.aiMemory.create} onChange={(v) => setSettings({ ...settings, modules: { ...mod, aiMemory: { ...mod.aiMemory, create: v } } })} />
              <ToggleRow label="Upravovat" checked={mod.aiMemory.update} onChange={(v) => setSettings({ ...settings, modules: { ...mod, aiMemory: { ...mod.aiMemory, update: v } } })} />
              <ToggleRow label="Vypínat postupy" checked={mod.aiMemory.disable} onChange={(v) => setSettings({ ...settings, modules: { ...mod, aiMemory: { ...mod.aiMemory, disable: v } } })} />
            </>
          )}
        </div>

        <Button disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit nastavení"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
