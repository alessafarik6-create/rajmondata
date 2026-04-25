"use client";

import React, { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import {
  type EmployeeDocumentTemplateDoc,
  type EmployeeDocumentTemplateType,
} from "@/lib/employee-documents-schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";

const TYPE_LABEL: Record<EmployeeDocumentTemplateType, string> = {
  employment_contract: "Pracovní smlouva",
  dpp: "DPP",
  dpc: "DPČ",
  agreement_other: "Dohoda / jiný dokument",
};

const PLACEHOLDERS = [
  "{{employeeName}}",
  "{{employeeEmail}}",
  "{{employeePhone}}",
  "{{employeeAddress}}",
  "{{employeePosition}}",
  "{{hourlyRate}}",
  "{{salary}}",
  "{{companyName}}",
  "{{companyICO}}",
  "{{companyAddress}}",
  "{{companyRepresentative}}",
  "{{todayDate}}",
  "{{contractStartDate}}",
] as const;

export function EmployeeDocumentTemplatesSettingsCard(props: {
  companyId: string;
  canManage: boolean;
}) {
  const { companyId, canManage } = props;
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  const templatesRef = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employeeDocumentTemplates");
  }, [firestore, companyId]);

  const { data: raw = [], isLoading, error } = useCollection(templatesRef, {
    suppressGlobalPermissionError: true as const,
  });

  const templates = useMemo((): EmployeeDocumentTemplateDoc[] => {
    const rows = Array.isArray(raw) ? raw : [];
    return rows
      .map((t: any) => ({
        id: String(t?.id ?? ""),
        companyId: String(t?.companyId ?? ""),
        title: String(t?.title ?? ""),
        type: String(t?.type ?? "agreement_other") as EmployeeDocumentTemplateType,
        content: String(t?.content ?? ""),
        createdAt: t?.createdAt,
        updatedAt: t?.updatedAt,
        createdBy: t?.createdBy != null ? String(t.createdBy) : undefined,
        updatedBy: t?.updatedBy != null ? String(t.updatedBy) : undefined,
      }))
      .filter((t) => t.id)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [raw]);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeDocumentTemplateDoc | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formType, setFormType] = useState<EmployeeDocumentTemplateType>("agreement_other");
  const [formContent, setFormContent] = useState("");
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setFormTitle("");
    setFormType("agreement_other");
    setFormContent(
      `Název: {{employeeName}}\nE-mail: {{employeeEmail}}\n\nDne {{todayDate}} ...`
    );
    setEditOpen(true);
  };

  const openEdit = (t: EmployeeDocumentTemplateDoc) => {
    setEditing(t);
    setFormTitle(t.title || "");
    setFormType(t.type);
    setFormContent(t.content || "");
    setEditOpen(true);
  };

  const save = async () => {
    if (!canManage || !firestore || !companyId || !user) return;
    const title = formTitle.trim().slice(0, 200);
    const content = formContent.trim().slice(0, 200000);
    if (!title) {
      toast({ variant: "destructive", title: "Chybí název šablony" });
      return;
    }
    if (!content) {
      toast({ variant: "destructive", title: "Chybí obsah šablony" });
      return;
    }
    setSaving(true);
    try {
      if (editing?.id) {
        await updateDoc(
          doc(firestore, "companies", companyId, "employeeDocumentTemplates", editing.id),
          {
            title,
            type: formType,
            content,
            updatedAt: serverTimestamp(),
            updatedBy: user.uid,
          } as DocumentData
        );
        toast({ title: "Šablona uložena" });
      } else {
        await addDoc(collection(firestore, "companies", companyId, "employeeDocumentTemplates"), {
          companyId,
          title,
          type: formType,
          content,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user.uid,
          updatedBy: user.uid,
        });
        toast({ title: "Šablona vytvořena" });
      }
      setEditOpen(false);
      setEditing(null);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Uložení šablony selhalo" });
    } finally {
      setSaving(false);
    }
  };

  const [deleteRow, setDeleteRow] = useState<EmployeeDocumentTemplateDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    if (!canManage || !firestore || !companyId || !deleteRow?.id) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(firestore, "companies", companyId, "employeeDocumentTemplates", deleteRow.id));
      toast({ title: "Šablona smazána" });
      setDeleteRow(null);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Smazání selhalo" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Šablony zaměstnaneckých dokumentů</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Editor textu + proměnné. Šablony se použijí při generování PDF u konkrétního zaměstnance.
          </p>
        </div>
        <Button type="button" className="h-10" disabled={!canManage} onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Nová šablona
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            Dostupné proměnné
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLACEHOLDERS.map((p) => (
              <code key={p} className="rounded bg-white px-2 py-1 text-xs text-slate-800">
                {p}
              </code>
            ))}
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive">Šablony se nepodařilo načíst.</p>
        ) : isLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-700">
            <Loader2 className="h-4 w-4 animate-spin" /> Načítání…
          </p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-slate-700">Zatím žádné šablony.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Název</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead className="text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.title}</TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {TYPE_LABEL[t.type] ?? t.type}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9"
                          disabled={!canManage}
                          onClick={() => openEdit(t)}
                          aria-label="Upravit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 text-destructive"
                          disabled={!canManage}
                          onClick={() => setDeleteRow(t)}
                          aria-label="Smazat"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-black sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Upravit šablonu" : "Nová šablona"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Název</Label>
                <Input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  maxLength={200}
                  placeholder="např. Pracovní smlouva (standard)"
                  disabled={!canManage || saving}
                />
              </div>
              <div className="space-y-2">
                <Label>Typ</Label>
                <select
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as EmployeeDocumentTemplateType)}
                  disabled={!canManage || saving}
                >
                  {(Object.keys(TYPE_LABEL) as EmployeeDocumentTemplateType[]).map((k) => (
                    <option key={k} value={k}>
                      {TYPE_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Obsah šablony</Label>
              <Textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                className="min-h-[280px]"
                disabled={!canManage || saving}
              />
              <p className="text-xs text-muted-foreground">
                Tip: proměnné zapisujte přes <code>{"{{...}}"}</code>.
              </p>
            </div>
          </div>
          <DialogFooter className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="h-11" onClick={() => setEditOpen(false)} disabled={saving}>
              Zrušit
            </Button>
            <Button type="button" className="h-11" onClick={() => void save()} disabled={!canManage || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteRow != null} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <DialogContent className="border-slate-200 bg-white text-black sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Smazat šablonu?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-700">
            {deleteRow ? `Opravdu smazat „${deleteRow.title}“?` : ""}
          </p>
          <DialogFooter className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="h-11" onClick={() => setDeleteRow(null)} disabled={deleting}>
              Zrušit
            </Button>
            <Button type="button" variant="destructive" className="h-11" onClick={() => void doDelete()} disabled={!canManage || deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Smazat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

