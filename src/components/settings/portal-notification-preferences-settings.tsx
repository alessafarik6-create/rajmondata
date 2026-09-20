"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import type { NotificationPreferenceGroups } from "@/lib/notification-service/types";
import { Loader2 } from "lucide-react";

const GROUPS: { key: keyof NotificationPreferenceGroups; label: string; hint?: string }[] = [
  { key: "pushEnabled", label: "Push oznámení (Web Push / PWA)" },
  { key: "emailEnabled", label: "E-mailová oznámení (modulové e-maily)" },
  { key: "jobs", label: "Zakázky" },
  { key: "emails", label: "E-maily ve schránce" },
  { key: "inquiries", label: "Poptávky" },
  { key: "documents", label: "Doklady a faktury" },
  { key: "tasks", label: "Úkoly a připomínky" },
  { key: "meetings", label: "Schůzky" },
  { key: "attendance", label: "Docházka" },
  { key: "urgent", label: "Urgentní oznámení" },
];

export function PortalNotificationPreferencesSettings() {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferenceGroups | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/notifications/preferences", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Načtení selhalo.");
      setPrefs(data.preferences);
    } catch (e) {
      toast({ title: "Oznámení", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: NotificationPreferenceGroups) => {
    if (!user) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Uložení selhalo.");
      setPrefs(data.preferences);
      toast({ title: "Uloženo", description: "Předvolby oznámení byly aktualizovány." });
    } catch (e) {
      toast({ title: "Chyba", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof NotificationPreferenceGroups) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    void save(next);
  };

  if (loading || !prefs) {
    return (
      <Card>
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface border-border">
      <CardHeader>
        <CardTitle>Předvolby oznámení</CardTitle>
        <CardDescription>
          Ovlivňují in-app zvoněk a Web Push. E-mailové modulové notifikace řídí také sekce E-mailová oznámení.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {GROUPS.map((g) => (
          <div key={g.key} className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor={`pref-${g.key}`}>{g.label}</Label>
              {g.hint ? <p className="text-xs text-muted-foreground">{g.hint}</p> : null}
            </div>
            <Switch
              id={`pref-${g.key}`}
              checked={Boolean(prefs[g.key])}
              disabled={saving}
              onCheckedChange={() => toggle(g.key)}
            />
          </div>
        ))}
        <p className="text-xs text-muted-foreground pt-2">
          Tiché hodiny (22:00–06:00) jsou připraveny v datech — plánování doručení bude doplněno; urgentní události
          projdou i v tichém režimu.
        </p>
        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void load()}>
          Obnovit
        </Button>
      </CardContent>
    </Card>
  );
}
