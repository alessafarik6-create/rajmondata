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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { coerceHelpModuleToCanonical, HELP_PORTAL_MODULES } from "@/lib/help-content";

type Row = {
  id: string;
  companyId?: string;
  module?: string;
  question?: string;
  answer?: string;
  keywords?: string[];
  order?: number;
  isActive?: boolean;
};

const emptyForm = {
  companyId: "global",
  module: "dashboard",
  question: "",
  answer: "",
  keywordsText: "",
  order: 0,
  isActive: true,
};

export default function AdminHelpContentPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Row[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/help-content", { cache: "no-store", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: data?.error ?? "Načtení se nezdařilo.",
        });
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditingId(row.id);
    setForm({
      companyId: String(row.companyId ?? "global"),
      module: coerceHelpModuleToCanonical(String(row.module ?? "")) ?? "dashboard",
      question: String(row.question ?? ""),
      answer: String(row.answer ?? ""),
      keywordsText: Array.isArray(row.keywords) ? row.keywords.join(", ") : "",
      order: Number(row.order) || 0,
      isActive: row.isActive !== false,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const keywords = form.keywordsText
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = {
        companyId: form.companyId.trim() || "global",
        module: form.module,
        question: form.question.trim(),
        answer: form.answer.trim(),
        keywords,
        order: Number(form.order) || 0,
        isActive: form.isActive,
      };
      if (!payload.question || !payload.answer) {
        toast({ variant: "destructive", title: "Vyplňte otázku a odpověď." });
        return;
      }
      const url = editingId ? `/api/superadmin/help-content/${editingId}` : "/api/superadmin/help-content";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: data?.error ?? "Uložení se nezdařilo.",
        });
        return;
      }
      toast({ title: editingId ? "Uloženo" : "Přidáno", description: "Položka nápovědy byla uložena." });
      setDialogOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Opravdu smazat tuto položku nápovědy?")) return;
    try {
      const res = await fetch(`/api/superadmin/help-content/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ variant: "destructive", title: "Chyba", description: data?.error ?? "Mazání se nezdařilo." });
        return;
      }
      toast({ title: "Smazáno" });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Chyba při mazání" });
    }
  };

  const toggleActive = async (row: Row, nextActive: boolean) => {
    try {
      const res = await fetch(`/api/superadmin/help-content/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) {
        toast({ variant: "destructive", title: "Chyba", description: "Stav se nepodařilo změnit." });
        return;
      }
      await load();
    } catch {
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Nápověda portálu</h1>
          <p className="text-sm text-slate-600 mt-1">
            Správa rychlých otázek a odpovědí v plovoucím chatu portálu. Data se ukládají do Firestore (
            <code className="rounded bg-slate-100 px-1 text-xs">helpContent</code>).
          </p>
        </div>
        <Button type="button" onClick={openCreate} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Nová otázka
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Přehled</CardTitle>
          <CardDescription>Všechny položky včetně vypnutých. V portálu se zobrazují jen aktivní.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-slate-600 py-8 justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
              Načítám…
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-600 py-6 text-center">Zatím žádné záznamy. Přidejte první otázku.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="p-3">Aktivní</th>
                    <th className="p-3">Pořadí</th>
                    <th className="p-3">Firma</th>
                    <th className="p-3">Modul</th>
                    <th className="p-3 min-w-[200px]">Otázka</th>
                    <th className="p-3 w-32">Akce</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((row) => (
                    <tr key={row.id} className={row.isActive === false ? "opacity-60" : ""}>
                      <td className="p-3">
                        <Switch
                          checked={row.isActive !== false}
                          onCheckedChange={(c) => toggleActive(row, c)}
                          aria-label={row.isActive === false ? "Zapnout" : "Vypnout"}
                        />
                      </td>
                      <td className="p-3 tabular-nums">{row.order ?? 0}</td>
                      <td className="p-3 font-mono text-xs">{row.companyId ?? "—"}</td>
                      <td className="p-3">{row.module ?? "—"}</td>
                      <td className="p-3 text-slate-800">{row.question ?? "—"}</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => remove(row.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Upravit otázku" : "Nová otázka"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="hc-company">ID firmy nebo „global“</Label>
              <Input
                id="hc-company"
                value={form.companyId}
                onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                placeholder="global"
                className="font-mono text-sm"
              />
            </div>
            <div className="grid gap-2">
              <Label>Modul</Label>
              <Select value={form.module} onValueChange={(v) => setForm((f) => ({ ...f, module: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HELP_PORTAL_MODULES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hc-q">Otázka (zobrazení v rychlých tlačítkách)</Label>
              <Input
                id="hc-q"
                value={form.question}
                onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
                placeholder="např. Jak vytvořit zakázku"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hc-a">Odpověď</Label>
              <Textarea
                id="hc-a"
                value={form.answer}
                onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
                rows={8}
                placeholder="Stručný návod pro uživatele portálu…"
                className="resize-y min-h-[120px]"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hc-kw">Klíčová slova (čárkou)</Label>
              <Input
                id="hc-kw"
                value={form.keywordsText}
                onChange={(e) => setForm((f) => ({ ...f, keywordsText: e.target.value }))}
                placeholder="faktura, záloha, VS"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hc-order">Pořadí (číslo, menší = výš)</Label>
              <Input
                id="hc-order"
                type="number"
                value={form.order}
                onChange={(e) => setForm((f) => ({ ...f, order: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="hc-active" checked={form.isActive} onCheckedChange={(c) => setForm((f) => ({ ...f, isActive: c }))} />
              <Label htmlFor="hc-active">Aktivní</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
