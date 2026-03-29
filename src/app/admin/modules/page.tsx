"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_PLATFORM_MODULES,
  PLATFORM_MODULE_CODES,
  type PlatformModuleCode,
} from "@/lib/platform-config";

type Mod = Record<string, unknown> & { code?: string; name?: string };

function mergeModuleRow(raw: Mod): Mod {
  const code = String(raw.code ?? raw.id ?? "").trim() as PlatformModuleCode;
  const def = DEFAULT_PLATFORM_MODULES.find((d) => d.code === code);
  return { ...(def as unknown as Mod), ...raw, code };
}

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
        toast({
          variant: "destructive",
          title: "Chyba",
          description: data?.error ?? "Načtení se nezdařilo.",
        });
        return;
      }
      const list = Array.isArray(data.modules) ? (data.modules as Mod[]) : [];
      const byCode = new Map<string, Mod>();
      for (const row of list) {
        const c = String(row.code ?? row.id ?? "").trim();
        if (c) byCode.set(c, row);
      }
      const ordered: Mod[] = PLATFORM_MODULE_CODES.map((code) =>
        mergeModuleRow(byCode.get(code) ?? { code })
      );
      setModules(ordered);
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
      const payload = modules.map((m) => {
        const { id: _id, ...rest } = m;
        const code = String(rest.code ?? "");
        const priceMonthly = Number(rest.priceMonthly ?? rest.basePriceCzk) || 0;
        const isAtt = code === "attendance_payroll";
        return {
          ...rest,
          code,
          name: String(rest.name ?? "").trim() || code,
          basePriceCzk: isAtt ? 0 : priceMonthly,
          priceMonthly,
          currency: String(rest.currency ?? "CZK").trim() || "CZK",
          billingPeriod: rest.billingPeriod === "yearly" ? "yearly" : "monthly",
          isPaid: Boolean(rest.isPaid),
          activeGlobally: Boolean(rest.activeGlobally),
          defaultEnabled: Boolean(rest.defaultEnabled),
        };
      });
      const res = await fetch("/api/superadmin/platform-modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: payload }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Uloženo", description: "Moduly a ceny byly aktualizovány." });
      await load();
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
        <p className="mt-1 text-slate-800">
          Dostupnost modulů na platformě a ceny za měsíc (ukládá se do{" "}
          <code className="rounded bg-slate-100 px-1 text-sm">platform_modules/&lt;code&gt;</code>).
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Moduly a ceník</CardTitle>
          <Button type="button" onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-8">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            modules.map((m, idx) => (
              <div
                key={String(m.code ?? idx)}
                className="grid gap-4 border-b border-slate-200 pb-8 last:border-0 lg:grid-cols-2"
              >
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Název modulu</Label>
                    <Input
                      value={String(m.name ?? "")}
                      onChange={(e) => update(idx, { name: e.target.value })}
                    />
                  </div>
                  <p className="text-xs font-mono text-slate-600">Kód: {String(m.code ?? "")}</p>
                  <p className="text-sm text-slate-800">{String(m.description ?? "")}</p>
                  <div className="flex flex-wrap items-center gap-4 pt-1">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={Boolean(m.activeGlobally)}
                        onCheckedChange={(v) => update(idx, { activeGlobally: v })}
                      />
                      <span className="text-sm">Aktivní globálně</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={Boolean(m.defaultEnabled)}
                        onCheckedChange={(v) => update(idx, { defaultEnabled: v })}
                      />
                      <span className="text-sm">Výchozí u nové firmy</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={Boolean(m.isPaid)}
                        onCheckedChange={(v) => update(idx, { isPaid: v })}
                      />
                      <span className="text-sm">Placený modul</span>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Cena za měsíc ({String(m.currency ?? "CZK")})</Label>
                    <Input
                      type="number"
                      value={
                        m.priceMonthly !== undefined && m.priceMonthly !== null
                          ? String(m.priceMonthly)
                          : String(m.basePriceCzk ?? "")
                      }
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        update(idx, { priceMonthly: v, basePriceCzk: m.code === "attendance_payroll" ? 0 : v });
                      }}
                    />
                    <p className="text-xs text-slate-600">
                      U docházky je základ 0 Kč; připočítává se cena za zaměstnance.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label>Měna</Label>
                    <Select
                      value={String(m.currency ?? "CZK")}
                      onValueChange={(v) => update(idx, { currency: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CZK">CZK</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Fakturační období</Label>
                    <Select
                      value={m.billingPeriod === "yearly" ? "yearly" : "monthly"}
                      onValueChange={(v) =>
                        update(idx, { billingPeriod: v === "yearly" ? "yearly" : "monthly" })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Měsíčně</SelectItem>
                        <SelectItem value="yearly">Ročně</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {m.code === "attendance_payroll" ? (
                    <div className="space-y-1 sm:col-span-2">
                      <Label>Cena / zaměstnanec / měsíc (Kč)</Label>
                      <Input
                        type="number"
                        value={
                          m.employeePriceCzk !== undefined ? String(m.employeePriceCzk) : ""
                        }
                        onChange={(e) =>
                          update(idx, { employeePriceCzk: Number(e.target.value) || 0 })
                        }
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
