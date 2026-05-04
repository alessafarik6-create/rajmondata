"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentData, Firestore } from "firebase/firestore";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { AnnotationModelDoc, AnnotationModelShape } from "@/lib/annotation-models";
import { removeUndefinedDeep } from "@/lib/firestore-clean-payload";
import { Pencil, Trash2 } from "lucide-react";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type FormState = {
  name: string;
  shape: AnnotationModelShape;
  widthMm: number;
  heightMm: number;
  legendDescription: string;
  color: string;
  note: string;
};

const emptyForm = (): FormState => ({
  name: "",
  shape: "square",
  widthMm: 20,
  heightMm: 20,
  legendDescription: "",
  color: "#2563eb",
  note: "",
});

export function AnnotationModelsSettingsDialog({
  open,
  onOpenChange,
  firestore,
  companyId,
  userId,
  models,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firestore: Firestore | null;
  companyId: string | null;
  userId: string | null;
  models: AnnotationModelDoc[];
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setEditingId(null);
      setForm(emptyForm());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = models.filter((m) => m?.id);
    if (!q) return list;
    return list.filter((m) => (m.name || "").toLowerCase().includes(q));
  }, [models, search]);

  const loadForEdit = useCallback((m: AnnotationModelDoc) => {
    setEditingId(m.id);
    setForm({
      name: m.name || "",
      shape: m.shape || "square",
      widthMm: Number(m.widthMm) || 0,
      heightMm: Number(m.heightMm) || 0,
      legendDescription: m.legendDescription?.trim() || "",
      color: (m.color || "#2563eb").trim(),
      note: m.note?.trim() || "",
    });
  }, []);

  const saveModel = useCallback(async () => {
    if (!firestore || !companyId || !userId) return;
    const n = form.name.trim();
    if (!n) {
      toast({
        variant: "destructive",
        title: "Chybí název",
        description: "Zadejte název modelu.",
      });
      return;
    }
    setSaving(true);
    try {
      const ld = form.legendDescription.trim();
      const nt = form.note.trim();

      if (editingId) {
        const patch: DocumentData = {
          organizationId: companyId,
          name: n,
          widthMm: Number(form.widthMm) || 0,
          heightMm: Number(form.heightMm) || 0,
          shape: form.shape,
          color: form.color.trim() || "#2563eb",
          updatedAt: serverTimestamp(),
          legendDescription: ld ? ld : deleteField(),
          note: nt ? nt : deleteField(),
        };
        await updateDoc(
          doc(firestore, "companies", companyId, "annotationModels", editingId),
          removeUndefinedDeep(patch) as DocumentData
        );
        toast({ title: "Model uložen", description: n });
      } else {
        const docData: DocumentData = {
          organizationId: companyId,
          name: n,
          widthMm: Number(form.widthMm) || 0,
          heightMm: Number(form.heightMm) || 0,
          shape: form.shape,
          color: form.color.trim() || "#2563eb",
          updatedAt: serverTimestamp(),
          createdBy: userId,
          createdAt: serverTimestamp(),
        };
        if (ld) docData.legendDescription = ld;
        if (nt) docData.note = nt;
        await addDoc(
          collection(firestore, "companies", companyId, "annotationModels"),
          removeUndefinedDeep(docData) as DocumentData
        );
        toast({ title: "Model uložen", description: n });
      }
      setEditingId(null);
      setForm(emptyForm());
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [firestore, companyId, userId, form, editingId, toast]);

  const removeModel = useCallback(
    async (id: string, name: string) => {
      if (!firestore || !companyId) return;
      if (!window.confirm(`Smazat model „${name}“?`)) return;
      setDeletingId(id);
      try {
        await deleteDoc(doc(firestore, "companies", companyId, "annotationModels", id));
        toast({ title: "Model smazán" });
        if (editingId === id) {
          setEditingId(null);
          setForm(emptyForm());
        }
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Smazání se nezdařilo",
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setDeletingId(null);
      }
    },
    [firestore, companyId, toast, editingId]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="z-[560]"
        className="!z-[570] flex max-h-[min(90dvh,720px)] flex-col gap-0 overflow-hidden sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Nastavení modelů</DialogTitle>
          <DialogDescription>
            Šablony značek pro legendu u anotací. Uložené modely můžete vkládat nástrojem Značka.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2 pr-1">
          <div className="space-y-2">
            <Label htmlFor="ann-model-search">Vyhledat podle názvu</Label>
            <Input
              id="ann-model-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="např. Pračka"
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Uložené modely</p>
            {filtered.length ? (
              <ul className="max-h-[min(30dvh,220px)] space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                {filtered.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.shape} · {m.widthMm} × {m.heightMm} mm
                        {m.legendDescription ? ` · ${m.legendDescription}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 gap-1"
                      onClick={() => loadForEdit(m)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Upravit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={deletingId === m.id}
                      onClick={() => void removeModel(m.id, m.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {models.length ? "Žádný model neodpovídá hledání." : "Zatím nemáte uložený žádný model."}
              </p>
            )}
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm font-semibold">{editingId ? "Upravit model" : "Nový model"}</p>
            <div className="grid gap-3 text-sm">
              <div className="space-y-1.5">
                <Label htmlFor="ann-m-name">Název modelu</Label>
                <Input
                  id="ann-m-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="např. Pračka"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tvar</Label>
                <select
                  className={SELECT_CLASS}
                  value={form.shape}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      shape: e.target.value as AnnotationModelShape,
                    }))
                  }
                >
                  <option value="square">Čtverec</option>
                  <option value="rectangle">Obdélník</option>
                  <option value="circle">Kruh</option>
                  <option value="point">Bod</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ann-m-w">Šířka (mm)</Label>
                  <Input
                    id="ann-m-w"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={form.widthMm}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, widthMm: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ann-m-h">Výška (mm)</Label>
                  <Input
                    id="ann-m-h"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={form.heightMm}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, heightMm: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ann-m-legend">Popis do legendy</Label>
                <Textarea
                  id="ann-m-legend"
                  rows={2}
                  value={form.legendDescription}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, legendDescription: e.target.value }))
                  }
                  placeholder="např. přívod vody vlevo"
                  className="resize-y"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ann-m-color">Barva (hex / CSS)</Label>
                <div className="flex gap-2">
                  <Input
                    id="ann-m-color"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    placeholder="#2563eb"
                    className="flex-1"
                  />
                  <input
                    type="color"
                    aria-label="Výběr barvy"
                    className="h-10 w-12 cursor-pointer rounded border border-input bg-background"
                    value={hexToInputColor(form.color)}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ann-m-note">Poznámka (interní, není v legendě)</Label>
                <Textarea
                  id="ann-m-note"
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  className="resize-y"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border pt-4 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {editingId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm());
                }}
              >
                Zrušit úpravu
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Zavřít
            </Button>
            <Button type="button" disabled={saving} onClick={() => void saveModel()}>
              {saving ? "Ukládám…" : "Uložit model"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function hexToInputColor(s: string): string {
  const t = s.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t;
  return "#2563eb";
}

/** Firestore update nemá deleteField bez importu — použijeme prázdné řetězce u volitelných polí kde pravidla dovolí */
