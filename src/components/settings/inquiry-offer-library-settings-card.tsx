"use client";

import React, { useMemo, useRef, useState } from "react";
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
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2, Paperclip } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  INQUIRY_OFFER_LIBRARY_COLLECTION,
  parseInquiryOfferLibraryDoc,
} from "@/lib/inquiry-offer-attachments";

type Props = { companyId: string };

type LibraryRow = ReturnType<typeof parseInquiryOfferLibraryDoc>;

export function InquiryOfferLibrarySettingsCard({ companyId }: Props) {
  const firestore = useFirestore();
  const storage = getFirebaseStorage();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [active, setActive] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [existingPath, setExistingPath] = useState("");
  const [existingUrl, setExistingUrl] = useState("");
  const [existingContentType, setExistingContentType] = useState<string | null>(null);
  const [existingSize, setExistingSize] = useState<number | null>(null);

  const q = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, INQUIRY_OFFER_LIBRARY_COLLECTION),
      orderBy("sortOrder", "asc")
    );
  }, [firestore, companyId]);

  const { data: raw, isLoading } = useCollection(q);
  const items = useMemo(() => {
    const list = Array.isArray(raw) ? raw : [];
    return list
      .map((d) => {
        const row = d as Record<string, unknown> & { id?: string };
        const id = String(row.id ?? "").trim();
        if (!id) return null;
        return parseInquiryOfferLibraryDoc(id, row);
      })
      .filter((x): x is LibraryRow => x != null);
  }, [raw]);

  const openNew = () => {
    setEditingId(null);
    setName("");
    setCategory("");
    setActive(true);
    setPendingFile(null);
    setExistingPath("");
    setExistingUrl("");
    setExistingContentType(null);
    setExistingSize(null);
    setEditorOpen(true);
  };

  const openEdit = (item: LibraryRow) => {
    setEditingId(item.id ?? null);
    setName(item.name);
    setCategory(item.category ?? "");
    setActive(item.active !== false);
    setPendingFile(null);
    setExistingPath(item.storagePath);
    setExistingUrl(item.downloadUrl);
    setExistingContentType(item.contentType ?? null);
    setExistingSize(item.sizeBytes ?? null);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!firestore || !companyId || !name.trim()) return;
    if (!editingId && !pendingFile) {
      toast({ variant: "destructive", title: "Vyberte soubor k nahrání" });
      return;
    }
    setSaving(true);
    try {
      let storagePath = existingPath;
      let downloadUrl = existingUrl;
      let contentType = existingContentType;
      let sizeBytes = existingSize;

      if (pendingFile && storage) {
        setUploading(true);
        const safeName = pendingFile.name.replace(/[^\w.\-()+]/g, "_").slice(0, 120);
        const id = editingId || `lib-${Date.now()}`;
        storagePath = `companies/${companyId}/inquiry-offer-library/${id}/${safeName}`;
        const sref = ref(storage, storagePath);
        await uploadBytes(sref, pendingFile, { contentType: pendingFile.type || undefined });
        downloadUrl = await getDownloadURL(sref);
        contentType = pendingFile.type || null;
        sizeBytes = pendingFile.size;
        setUploading(false);
      }

      if (!storagePath || !downloadUrl) {
        throw new Error("Chybí soubor přílohy.");
      }

      const payload = {
        companyId,
        name: name.trim(),
        category: category.trim() || null,
        active,
        storagePath,
        downloadUrl,
        contentType,
        sizeBytes,
        sortOrder: items.length,
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        await updateDoc(
          doc(firestore, "companies", companyId, INQUIRY_OFFER_LIBRARY_COLLECTION, editingId),
          payload
        );
      } else {
        await addDoc(collection(firestore, "companies", companyId, INQUIRY_OFFER_LIBRARY_COLLECTION), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      toast({ title: "Příloha uložena" });
      setEditorOpen(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!firestore || !companyId) return;
    if (!window.confirm("Smazat přílohu z knihovny?")) return;
    try {
      await deleteDoc(doc(firestore, "companies", companyId, INQUIRY_OFFER_LIBRARY_COLLECTION, id));
      toast({ title: "Příloha smazána" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Smazání se nezdařilo.",
      });
    }
  };

  return (
    <Card className="border-slate-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-5 w-5 text-orange-700" />
          Přílohy k nabídkám
        </CardTitle>
        <CardDescription>
          Soubory pro opakované použití v e-mailových nabídkách (ceníky, brožury, obrázky).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button type="button" variant="secondary" className="gap-2" onClick={openNew}>
          <Plus className="h-4 w-4" />
          Nahrát soubor
        </Button>
        {isLoading ? (
          <p className="text-sm text-slate-500">Načítám knihovnu…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádné soubory v knihovně.</p>
        ) : (
          <ul className="divide-y rounded-md border border-slate-200">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    {item.category || "bez kategorie"}
                    {item.active === false ? " · neaktivní" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openEdit(item)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => item.id && void handleDelete(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingId ? "Upravit přílohu" : "Nová příloha v knihovně"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Soubor</Label>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setPendingFile(f);
                      if (!name.trim()) setName(f.name);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => fileRef.current?.click()}
                >
                  {pendingFile ? pendingFile.name : editingId ? "Nahradit soubor (volitelné)" : "Vybrat soubor"}
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lib-name">Název</Label>
                <Input id="lib-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lib-cat">Kategorie</Label>
                <Input
                  id="lib-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="např. Ceník, Brožura"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="lib-active">Aktivní</Label>
                <Switch id="lib-active" checked={active} onCheckedChange={setActive} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
                Zrušit
              </Button>
              <Button
                type="button"
                disabled={saving || uploading}
                onClick={() => void handleSave()}
              >
                {(saving || uploading) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Uložit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
