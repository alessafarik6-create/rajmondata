"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from "@/firebase";
import { doc, collection, addDoc, serverTimestamp, updateDoc, deleteDoc } from "firebase/firestore";
import { ChevronLeft, Plus, Loader2, FileStack } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { JobTemplate, JobTemplateSection, JobTemplateField } from "@/lib/job-templates";
import { JobTemplateFieldEditor } from "@/components/jobs/job-template-field-editor";

function generateId() {
  return Math.random().toString(36).slice(2, 12);
}

const defaultSection = (): JobTemplateSection => ({
  id: generateId(),
  name: "Sekce",
  order: 0,
  fields: [],
});

const defaultField = (): JobTemplateField => ({
  id: generateId(),
  type: "short_text",
  label: "Nové pole",
  required: false,
});

export default function JobTemplatesPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const userRef = useMemoFirebase(() => (user && firestore ? doc(firestore, "users", user.uid) : null), [firestore, user]);
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId;
  const isAdmin = profile?.role === "owner" || profile?.role === "admin" || profile?.globalRoles?.includes("super_admin");

  const templatesRef = useMemoFirebase(
    () => (firestore && companyId ? collection(firestore, "companies", companyId, "jobTemplates") : null),
    [firestore, companyId]
  );
  const { data: templates, isLoading } = useCollection(templatesRef);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<Pick<JobTemplate, "name" | "productType" | "description" | "sections">>({
    name: "",
    productType: "",
    description: "",
    sections: [defaultSection()],
  });

  const resetFormToEmpty = () => {
    setForm({
      name: "",
      productType: "",
      description: "",
      sections: [defaultSection()],
    });
  };

  const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

  const templateToForm = (
    tpl: JobTemplate & { id?: string } | null | undefined
  ): Pick<JobTemplate, "name" | "productType" | "description" | "sections"> => {
    if (!tpl) {
      return {
        name: "",
        productType: "",
        description: "",
        sections: [defaultSection()],
      };
    }

    return {
      name: tpl.name || "",
      productType: tpl.productType || "",
      description: tpl.description || "",
      sections: deepClone(tpl.sections || []),
    };
  };

  const regenerateIdsInSections = (sections: JobTemplateSection[]): JobTemplateSection[] => {
    return (sections || []).map((s) => ({
      ...deepClone(s),
      id: generateId(),
      fields: (s.fields || []).map((f) => ({
        ...deepClone(f),
        id: generateId(),
      })),
    }));
  };

  const addSection = () => {
    setForm((prev) => ({
      ...prev,
      sections: [...prev.sections, { ...defaultSection(), order: prev.sections.length }],
    }));
  };

  const updateSection = (index: number, section: JobTemplateSection) => {
    setForm((prev) => {
      const next = [...prev.sections];
      next[index] = section;
      return { ...prev, sections: next };
    });
  };

  const removeSection = (index: number) => {
    setForm((prev) => ({ ...prev, sections: prev.sections.filter((_, i) => i !== index) }));
  };

  const addField = (sectionIndex: number) => {
    setForm((prev) => {
      const sections = [...prev.sections];
      const sec = { ...sections[sectionIndex], fields: [...sections[sectionIndex].fields, defaultField()] };
      sections[sectionIndex] = sec;
      return { ...prev, sections };
    });
  };

  const updateField = (sectionIndex: number, fieldIndex: number, field: JobTemplateField) => {
    setForm((prev) => {
      const sections = [...prev.sections];
      const fields = [...sections[sectionIndex].fields];
      fields[fieldIndex] = field;
      sections[sectionIndex] = { ...sections[sectionIndex], fields };
      return { ...prev, sections };
    });
  };

  const removeField = (sectionIndex: number, fieldIndex: number) => {
    setForm((prev) => {
      const sections = [...prev.sections];
      const fields = sections[sectionIndex].fields.filter((_, i) => i !== fieldIndex);
      sections[sectionIndex] = { ...sections[sectionIndex], fields };
      return { ...prev, sections };
    });
  };

  const handleSave = async () => {
    if (!templatesRef || !form.name.trim()) {
      toast({ variant: "destructive", title: "Název šablony je povinný." });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        sections: form.sections.map((s, i) => ({ ...s, order: i })),
      };

      if (dialogMode === "edit" && activeTemplateId) {
        const tplRef = doc(firestore, "companies", companyId, "jobTemplates", activeTemplateId);
        await updateDoc(tplRef, {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        toast({
          title: "Šablona aktualizována",
          description: `"${form.name}" byla aktualizována.`,
        });
      } else {
        await addDoc(templatesRef, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast({ title: "Šablona vytvořena", description: `"${form.name}" byla uložena.` });
      }

      setDialogOpen(false);
      setActiveTemplateId(null);
      setDialogMode("create");
      resetFormToEmpty();
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba", description: "Šablonu se nepodařilo uložit." });
    } finally {
      setSaving(false);
    }
  };

  if (isProfileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="space-y-6">
        <Link href="/portal/jobs">
          <Button variant="ghost" className="gap-2">
            <ChevronLeft className="w-4 h-4" /> Zpět na zakázky
          </Button>
        </Link>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nejste přiřazeni k firmě. Šablony zakázek nelze načíst.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <Link href="/portal/jobs">
          <Button variant="ghost" className="gap-2">
            <ChevronLeft className="w-4 h-4" /> Zpět na zakázky
          </Button>
        </Link>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nemáte oprávnění ke správě šablon zakázek.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/portal/jobs">
            <Button variant="ghost" className="gap-2 -ml-2 mb-2">
              <ChevronLeft className="w-4 h-4" /> Zpět na zakázky
            </Button>
          </Link>
          <h1 className="portal-page-title text-2xl sm:text-3xl">Šablony zakázek</h1>
          <p className="portal-page-description">
            Definujte typy projektů a pole, která se zobrazí při vytváření zakázky.
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setActiveTemplateId(null);
              setDialogMode("create");
              resetFormToEmpty();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              className="gap-2 shrink-0"
              onClick={() => {
                setDialogMode("create");
                setActiveTemplateId(null);
                resetFormToEmpty();
              }}
            >
              <Plus className="w-4 h-4" /> Nová šablona
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white border-slate-200 text-slate-900" data-portal-dialog>
            <DialogHeader>
              <DialogTitle>
                {dialogMode === "edit" ? "Upravit šablonu zakázky" : "Nová šablona zakázky"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tpl-name">Název šablony</Label>
                  <Input
                    id="tpl-name"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Např. Pergola"
                    className="bg-white border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tpl-product">Typ produktu / projektu</Label>
                  <Input
                    id="tpl-product"
                    value={form.productType}
                    onChange={(e) => setForm((p) => ({ ...p, productType: e.target.value }))}
                    placeholder="Např. Pergola, Rodinný dům"
                    className="bg-white border-slate-200"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-desc">Popis (volitelné)</Label>
                <Input
                  id="tpl-desc"
                  value={form.description || ""}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Krátký popis šablony"
                  className="bg-white border-slate-200"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Sekce a pole</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addSection}>
                    + Sekce
                  </Button>
                </div>
                {form.sections.map((section, sIdx) => (
                  <Card key={section.id} className="mb-4 border-slate-200">
                    <CardHeader className="py-3">
                      <div className="flex gap-2 items-center">
                        <Input
                          value={section.name}
                          onChange={(e) => updateSection(sIdx, { ...section, name: e.target.value })}
                          placeholder="Název sekce"
                          className="bg-white border-slate-200 max-w-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeSection(sIdx)}
                          className="text-destructive hover:text-destructive"
                        >
                          Odebrat sekci
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0">
                      {section.fields.map((field, fIdx) => (
                        <JobTemplateFieldEditor
                          key={field.id}
                          field={field}
                          onChange={(f) => updateField(sIdx, fIdx, f)}
                          onRemove={() => removeField(sIdx, fIdx)}
                        />
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addField(sIdx)}
                        className="w-full border-dashed"
                      >
                        + Přidat pole
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Zrušit
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : dialogMode === "edit" ? (
                  "Uložit změny"
                ) : (
                  "Vytvořit šablonu"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : templates && templates.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileStack className="w-5 h-5 text-primary" />
                  {t.name}
                </CardTitle>
                <CardDescription>{t.productType || "—"}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-800">
                  {t.sections?.length || 0} sekcí,{" "}
                  {t.sections?.reduce((acc: number, s: JobTemplateSection) => acc + (s.fields?.length || 0), 0) || 0} polí
                </p>
                <Link href={`/portal/jobs?templateId=${t.id}`}>
                  <Button variant="outline" size="sm" className="mt-2 w-full">
                    Použít při vytváření zakázky
                  </Button>
                </Link>

                <div className="flex flex-col sm:flex-row gap-2 mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setDialogMode("edit");
                      setActiveTemplateId(t.id);
                      setForm(templateToForm(t));
                      setDialogOpen(true);
                    }}
                  >
                    Upravit
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    disabled={saving}
                    onClick={async () => {
                      try {
                        if (!templatesRef) return;
                        setSaving(true);
                        const baseName = (t.name || "").trim() || "Šablona";
                        const newName = baseName.endsWith(" - kopie")
                          ? baseName
                          : `${baseName} - kopie`;

                        const sectionsCopy = regenerateIdsInSections(
                          deepClone((t.sections || []) as JobTemplateSection[])
                        );

                        await addDoc(templatesRef, {
                          name: newName,
                          productType: t.productType || "",
                          description: t.description || "",
                          sections: sectionsCopy,
                          createdAt: serverTimestamp(),
                          updatedAt: serverTimestamp(),
                        });

                        toast({
                          title: "Šablona zkopírována",
                          description: `"${t.name}" → "${newName}".`,
                        });
                      } catch (e) {
                        console.error("[JobTemplatesPage] copy failed", e);
                        toast({
                          variant: "destructive",
                          title: "Chyba",
                          description: "Šablonu se nepodařilo zkopírovat.",
                        });
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    Kopírovat
                  </Button>

                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    disabled={saving || deleting}
                    onClick={async () => {
                      const templateId = t.id;
                      if (!templateId) {
                        toast({
                          variant: "destructive",
                          title: "Chyba",
                          description: "Nelze smazat šablonu: chybí ID.",
                        });
                        return;
                      }

                      const ok = window.confirm(
                        `Opravdu chcete smazat šablonu "${t.name}"?`
                      );
                      if (!ok) return;

                      try {
                        setDeleting(true);
                        const tplRef = doc(
                          firestore,
                          "companies",
                          companyId,
                          "jobTemplates",
                          templateId
                        );
                        await deleteDoc(tplRef);

                        // Pokud jsme právě upravovali/synchronizovali smazanou šablonu
                        if (activeTemplateId === templateId) {
                          setDialogOpen(false);
                          setDialogMode("create");
                          setActiveTemplateId(null);
                          resetFormToEmpty();
                        }

                        toast({
                          title: "Šablona smazána",
                          description: `"${t.name}" byla odstraněna.`,
                        });
                      } catch (e) {
                        console.error("[JobTemplatesPage] delete failed", e);
                        toast({
                          variant: "destructive",
                          title: "Chyba",
                          description: "Šablonu se nepodařilo smazat.",
                        });
                      } finally {
                        setDeleting(false);
                      }
                    }}
                  >
                    Smazat
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-slate-200">
          <CardContent className="py-12 text-center text-slate-800">
            <FileStack className="w-12 h-12 mx-auto mb-4 opacity-40" />
            <p className="font-medium">Zatím nemáte žádné šablony</p>
            <p className="text-sm mt-1">Vytvořte šablonu a při nové zakázce zvolte její pole.</p>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Nová šablona
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
