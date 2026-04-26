"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Pencil, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

type StepRow = {
  id: string;
  title?: string;
  description?: string;
  route?: string;
  targetSelector?: string | null;
  order?: number;
  enabled?: boolean;
};

const emptyForm = {
  title: "",
  description: "",
  route: "",
  targetSelector: "",
  order: 0,
  enabled: true,
};

function numOrder(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function AdminOnboardingStepsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<StepRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/onboarding-steps", { cache: "no-store", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: typeof data?.error === "string" ? data.error : "Načtení se nezdařilo.",
        });
        return;
      }
      const steps = Array.isArray(data.steps) ? data.steps : [];
      setItems(
        steps.sort((a: StepRow, b: StepRow) => numOrder(a.order) - numOrder(b.order))
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    const max = items.reduce((m, r) => Math.max(m, numOrder(r.order)), 0);
    setEditingId(null);
    setForm({ ...emptyForm, order: max + 1 });
    setDialogOpen(true);
  };

  const openEdit = (row: StepRow) => {
    setEditingId(row.id);
    setForm({
      title: String(row.title ?? ""),
      description: String(row.description ?? ""),
      route: String(row.route ?? ""),
      targetSelector: row.targetSelector != null ? String(row.targetSelector) : "",
      order: numOrder(row.order),
      enabled: row.enabled !== false,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    const title = form.title.trim();
    const description = form.description.trim();
    const route = form.route.trim();
    if (!title || !description || !route) {
      toast({ variant: "destructive", title: "Vyplňte název, popis a route." });
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const res = await fetch(`/api/superadmin/onboarding-steps/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            route,
            targetSelector: form.targetSelector.trim() || null,
            order: form.order,
            enabled: form.enabled,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            variant: "destructive",
            title: "Uložení se nezdařilo",
            description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
          });
          return;
        }
        toast({ title: "Uloženo" });
      } else {
        const res = await fetch("/api/superadmin/onboarding-steps", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            route,
            targetSelector: form.targetSelector.trim() || null,
            order: form.order,
            enabled: form.enabled,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            variant: "destructive",
            title: "Vytvoření se nezdařilo",
            description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
          });
          return;
        }
        toast({ title: "Krok přidán" });
      }
      setDialogOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Opravdu smazat tento krok průvodce?")) return;
    const res = await fetch(`/api/superadmin/onboarding-steps/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
      });
      return;
    }
    toast({ title: "Smazáno" });
    await load();
  };

  const toggleEnabled = async (row: StepRow) => {
    const newEnabled = row.enabled === false;
    const res = await fetch(`/api/superadmin/onboarding-steps/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newEnabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({
        variant: "destructive",
        title: "Aktualizace se nezdařila",
        description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
      });
      return;
    }
    await load();
  };

  const swapOrder = async (index: number, direction: -1 | 1) => {
    const j = index + direction;
    if (j < 0 || j >= items.length) return;
    const a = items[index];
    const b = items[j];
    const oa = numOrder(a.order);
    const ob = numOrder(b.order);
    setSaving(true);
    try {
      const r1 = await fetch(`/api/superadmin/onboarding-steps/${encodeURIComponent(a.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: ob }),
      });
      const r2 = await fetch(`/api/superadmin/onboarding-steps/${encodeURIComponent(b.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: oa }),
      });
      if (!r1.ok || !r2.ok) {
        toast({ variant: "destructive", title: "Změna pořadí se nezdařila." });
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Průvodce portálem</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kroky se ukládají do kolekce <code className="rounded bg-muted px-1">onboardingSteps</code> a zobrazují se
          firmám s nedokončeným onboardingu.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Kroky průvodce</CardTitle>
            <CardDescription>Přidání, úprava, pořadí a zapnutí/vypnutí jednotlivých kroků.</CardDescription>
          </div>
          <Button type="button" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Nový krok
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné kroky — portál použije výchozí konstantu v kódu.</p>
          ) : (
            <div className="space-y-3">
              {items.map((row, index) => (
                <div
                  key={row.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">#{numOrder(row.order)}</span>
                      {row.enabled === false ? (
                        <Badge variant="secondary">Vypnuto</Badge>
                      ) : (
                        <Badge className="bg-emerald-600">Zapnuto</Badge>
                      )}
                    </div>
                    <p className="font-medium">{row.title}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{row.description}</p>
                    <p className="text-xs font-mono text-muted-foreground">{row.route}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        disabled={index === 0 || saving}
                        onClick={() => void swapOrder(index, -1)}
                        aria-label="Posunout nahoru"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        disabled={index >= items.length - 1 || saving}
                        onClick={() => void swapOrder(index, 1)}
                        aria-label="Posunout dolů"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.enabled !== false}
                        onCheckedChange={() => void toggleEnabled(row)}
                        disabled={saving}
                      />
                      <span className="text-xs text-muted-foreground">Aktivní</span>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => openEdit(row)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Upravit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void remove(row.id)}
                      disabled={saving}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Smazat
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Upravit krok" : "Nový krok"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="ob-title">Název (title)</Label>
              <Input
                id="ob-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ob-desc">Popis (description)</Label>
              <Textarea
                id="ob-desc"
                rows={4}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ob-route">Route</Label>
              <Input
                id="ob-route"
                placeholder="/portal/..."
                value={form.route}
                onChange={(e) => setForm((f) => ({ ...f, route: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ob-sel">targetSelector (volitelně, CSS)</Label>
              <Input
                id="ob-sel"
                placeholder="#id nebo [data-...]"
                value={form.targetSelector}
                onChange={(e) => setForm((f) => ({ ...f, targetSelector: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ob-order">Pořadí (order)</Label>
                <Input
                  id="ob-order"
                  type="number"
                  value={form.order}
                  onChange={(e) => setForm((f) => ({ ...f, order: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Switch
                  id="ob-en"
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                />
                <Label htmlFor="ob-en">Zapnuto</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
