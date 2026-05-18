"use client";

import React, { useMemo, useState } from "react";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseInquiryOfferTemplateDoc } from "@/lib/inquiry-offer-email";

type Props = { companyId: string };

type TemplateRow = ReturnType<typeof parseInquiryOfferTemplateDoc>;

export function InquiryOfferTemplatesSettingsCard({ companyId }: Props) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [active, setActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);

  const q = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "inquiry_offer_templates"),
      orderBy("sortOrder", "asc")
    );
  }, [firestore, companyId]);

  const { data: raw, isLoading } = useCollection(q);
  const templates = useMemo(() => {
    const list = Array.isArray(raw) ? raw : [];
    return list
      .map((d) => {
        const row = d as Record<string, unknown> & { id?: string };
        const id = String(row.id ?? "").trim();
        if (!id) return null;
        return parseInquiryOfferTemplateDoc(id, row);
      })
      .filter(Boolean) as TemplateRow[];
  }, [raw]);

  const openNew = () => {
    setEditingId(null);
    setName("");
    setSubject("Nabídka – {firma}");
    setBodyText(
      "Dobrý den, {jmeno},\n\nděkujeme za Vaši poptávku typu {typ_poptavky}.\n\n{cena}\n\nS pozdravem,\n{firma}"
    );
    setActive(true);
    setIsDefault(templates.length === 0);
    setEditorOpen(true);
  };

  const openEdit = (t: TemplateRow) => {
    setEditingId(t.id ?? null);
    setName(t.name);
    setSubject(t.subject);
    setBodyText(t.bodyText);
    setActive(t.active);
    setIsDefault(t.isDefault);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!firestore || !companyId || !name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        companyId,
        name: name.trim(),
        subject: subject.trim(),
        bodyText: bodyText.trim(),
        active,
        isDefault,
        sortOrder: templates.length,
        updatedAt: serverTimestamp(),
      };
      if (isDefault) {
        for (const t of templates) {
          if (t.id && t.isDefault && t.id !== editingId) {
            await updateDoc(
              doc(firestore, "companies", companyId, "inquiry_offer_templates", t.id),
              { isDefault: false, updatedAt: serverTimestamp() }
            );
          }
        }
      }
      if (editingId) {
        await updateDoc(
          doc(firestore, "companies", companyId, "inquiry_offer_templates", editingId),
          payload
        );
      } else {
        await addDoc(collection(firestore, "companies", companyId, "inquiry_offer_templates"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      toast({ title: "Šablona uložena" });
      setEditorOpen(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!firestore || !companyId) return;
    if (!window.confirm("Smazat šablonu nabídky?")) return;
    try {
      await deleteDoc(doc(firestore, "companies", companyId, "inquiry_offer_templates", id));
      toast({ title: "Šablona smazána" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Smazání se nezdařilo.",
      });
    }
  };

  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Šablony e-mailových nabídek</CardTitle>
          <CardDescription>
            Šablony pro odpovědi na poptávky. Proměnné: {"{jmeno}"}, {"{cena}"}, {"{firma}"}…
          </CardDescription>
        </div>
        <Button type="button" size="sm" className="min-h-10 gap-1" onClick={openNew}>
          <Plus className="h-4 w-4" />
          Nová šablona
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádná šablona — vytvořte první.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{t.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.subject}</p>
                  {!t.active ? (
                    <span className="text-xs text-amber-700">Neaktivní</span>
                  ) : t.isDefault ? (
                    <span className="text-xs text-primary">Výchozí</span>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <Button type="button" size="icon" variant="ghost" onClick={() => openEdit(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => t.id && void handleDelete(t.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Upravit šablonu" : "Nová šablona nabídky"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <FormField label="Název šablony" id="tpl-name">
              <Input id="tpl-name" className="w-full" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Předmět e-mailu" id="tpl-subject">
              <Input id="tpl-subject" className="w-full" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </FormField>
            <FormField label="Výchozí text e-mailu" id="tpl-body">
              <Textarea id="tpl-body" rows={8} className="w-full resize-y" value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
            </FormField>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={active} onCheckedChange={setActive} id="tpl-active" />
                <Label htmlFor="tpl-active">Aktivní</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isDefault} onCheckedChange={setIsDefault} id="tpl-default" />
                <Label htmlFor="tpl-default">Výchozí šablona</Label>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="w-full min-h-11 sm:w-auto" onClick={() => setEditorOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" className="w-full min-h-11 sm:w-auto" disabled={saving} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit šablonu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FormField(props: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
    </div>
  );
}
