"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Mod = Record<string, unknown> & { code?: string; name?: string };

export default function AdminModulesPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modules, setModules] = useState<Mod[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/platform-modules", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: "destructive", title: "Chyba", description: data?.error ?? "Načtení se nezdařilo." });
        return;
      }
      setModules(Array.isArray(data.modules) ? data.modules : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/superadmin/platform-modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Uloženo", description: "Moduly byly aktualizovány." });
    } catch {
      toast({ variant: "destructive", title: "Chyba při ukládání" });
    } finally {
      setSaving(false);
    }
  };

  const update = (idx: number, patch: Partial<Mod>) => {
    setModules((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Globální moduly</h1>
        <p className="mt-1 text-slate-800">Základní ceny a dostupnost modulů na celé platformě.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Moduly</CardTitle>
          <Button type="button" onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            modules.map((m, idx) => (
              <div
                key={String(m.code ?? idx)}
                className="grid gap-4 border-b border-slate-200 pb-6 last:border-0 md:grid-cols-2"
              >
                <div className="space-y-2">
                  <p className="font-semibold text-slate-900">{m.name ?? m.code}</p>
                  <p className="text-sm text-slate-800">{String(m.description ?? "")}</p>
                  <div className="flex items-center gap-2 pt-2">
                    <Switch
                      checked={Boolean(m.activeGlobally)}
                      onCheckedChange={(v) => update(idx, { activeGlobally: v })}
                    />
                    <span className="text-sm">Aktivní globálně</span>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Základní cena (Kč)</Label>
                    <Input
                      type="number"
                      value={m.basePriceCzk !== undefined ? String(m.basePriceCzk) : ""}
                      onChange={(e) => update(idx, { basePriceCzk: Number(e.target.value) || 0 })}
                    />
                  </div>
                  {m.code === "attendance_payroll" ? (
                    <div className="space-y-1">
                      <Label>Cena / zaměstnanec (Kč)</Label>
                      <Input
                        type="number"
                        value={m.employeePriceCzk !== undefined ? String(m.employeePriceCzk) : ""}
                        onChange={(e) => update(idx, { employeePriceCzk: Number(e.target.value) || 0 })}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
