"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { Loader2, ImageIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getFirebaseStorage } from "@/firebase";
import type { InventoryItemRow, InventoryStockTrackingMode } from "@/lib/inventory-types";

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "image";
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  firestore: Firestore;
  companyId: string;
  userId: string;
  item: InventoryItemRow | null;
  onSaved: () => void;
  stockCategories?: { id: string; name: string }[];
};

export function InventoryItemEditDialog({
  open,
  onOpenChange,
  firestore,
  companyId,
  userId,
  item,
  onSaved,
  stockCategories = [],
}: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [unit, setUnit] = useState("ks");
  const [quantity, setQuantity] = useState("0");
  const [unitPrice, setUnitPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stockTrackingMode, setStockTrackingMode] = useState<InventoryStockTrackingMode>("pieces");
  const [originalLengthInput, setOriginalLengthInput] = useState("");

  useEffect(() => {
    if (!open || !item) return;
    setName(item.name ?? "");
    setSku(String(item.sku ?? ""));
    setCategoryId(String(item.categoryId ?? "").trim());
    setUnit(item.unit || "ks");
    setQuantity(String(item.quantity ?? 0));
    setUnitPrice(
      item.unitPrice != null && Number.isFinite(Number(item.unitPrice))
        ? String(item.unitPrice)
        : ""
    );
    setSupplier(String(item.supplier ?? ""));
    setNote(String(item.note ?? ""));
    setImageUrl(item.imageUrl ?? null);
    setPendingFile(null);
    setPreviewUrl(null);
    const m = (item.stockTrackingMode as InventoryStockTrackingMode | undefined) || "pieces";
    setStockTrackingMode(
      m === "length" || m === "area" || m === "mass" || m === "generic" || m === "pieces" ? m : "pieces"
    );
    const ol = item.originalLength;
    setOriginalLengthInput(
      ol != null && Number.isFinite(Number(ol)) ? String(ol) : ""
    );
  }, [open, item]);

  useEffect(() => {
    if (!pendingFile) {
      setPreviewUrl(null);
      return;
    }
    const u = URL.createObjectURL(pendingFile);
    setPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [pendingFile]);

  const thumbSrc = previewUrl ?? imageUrl;

  const handleSave = async () => {
    if (!item) return;
    const n = name.trim();
    if (!n) {
      toast({ variant: "destructive", title: "Vyplňte název položky." });
      return;
    }
    const q = Number(String(quantity).replace(",", "."));
    if (!Number.isFinite(q) || q < 0) {
      toast({ variant: "destructive", title: "Množství musí být nezáporné číslo." });
      return;
    }
    const priceRaw = unitPrice.trim() === "" ? null : Number(String(unitPrice).replace(",", "."));
    const priceNum =
      priceRaw != null && Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : null;

    const catResolved =
      categoryId.trim() || null;
    const catNameResolved = catResolved
      ? (stockCategories.find((c) => c.id === catResolved)?.name ?? null)
      : null;

    setSaving(true);
    try {
      let nextImage = imageUrl;
      if (pendingFile) {
        const storage = getFirebaseStorage();
        const path = `companies/${companyId}/inventory/${item.id}/${Date.now()}-${safeFileName(pendingFile.name)}`;
        const ref = storageRef(storage, path);
        await uploadBytes(ref, pendingFile, {
          contentType: pendingFile.type || "application/octet-stream",
        });
        nextImage = await getDownloadURL(ref);
      }

      await runTransaction(firestore, async (tx) => {
        const itemRef = doc(firestore, "companies", companyId, "inventoryItems", item.id);
        const snap = await tx.get(itemRef);
        if (!snap.exists()) throw new Error("Položka neexistuje.");
        const prev = snap.data() as InventoryItemRow;
        if (prev.isDeleted === true) throw new Error("Položka byla odstraněna.");

        const oldQty = Number(prev.quantity ?? 0);
        const oldName = String(prev.name ?? "");
        const oldSku = String(prev.sku ?? "");
        const oldCat = String(prev.categoryId ?? "");
        const oldUnit = String(prev.unit ?? "ks");
        const oldSup = String(prev.supplier ?? "");
        const oldNote = String(prev.note ?? "");
        const oldP =
          prev.unitPrice != null && Number.isFinite(Number(prev.unitPrice))
            ? Number(prev.unitPrice)
            : null;
        const oldImg = prev.imageUrl ?? null;

        const u = unit.trim() || "ks";
        const origLenParsed =
          originalLengthInput.trim() === ""
            ? null
            : Number(String(originalLengthInput).replace(",", "."));
        const origLen =
          origLenParsed != null && Number.isFinite(origLenParsed) && origLenParsed >= 0
            ? origLenParsed
            : null;

        const basePatch: Record<string, unknown> = {
          name: n,
          sku: sku.trim() || null,
          categoryId: catResolved,
          categoryName: catNameResolved,
          /** Legacy fallback pro staré UI (zařazení materiálu) */
          materialCategory: catNameResolved,
          unit: u,
          quantity: q,
          stockTrackingMode: stockTrackingMode,
          unitPrice: priceNum,
          supplier: supplier.trim() || null,
          note: note.trim() || null,
          imageUrl: nextImage ?? null,
          updatedAt: serverTimestamp(),
        };
        if (stockTrackingMode === "length") {
          basePatch.currentLength = q;
          basePatch.lengthStockUnit = u;
          basePatch.originalLength = origLen;
        } else {
          basePatch.currentLength = null;
          basePatch.lengthStockUnit = null;
          basePatch.originalLength = null;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx.update(itemRef, basePatch as any);

        const today = new Date().toISOString().slice(0, 10);

        if (q !== oldQty) {
          const movRef = doc(collection(firestore, "companies", companyId, "inventoryMovements"));
          tx.set(movRef, {
            companyId,
            type: "adjustment",
            itemId: item.id,
            itemName: n,
            quantity: Math.abs(q - oldQty),
            unit: u,
            date: today,
            note: `Úprava množství: ${oldQty} → ${q} ${u}`,
            adjustmentDelta: q - oldQty,
            supplier: null,
            documentNo: null,
            destination: null,
            productionId: null,
            productionTitle: null,
            createdAt: serverTimestamp(),
            createdBy: userId,
          });
        } else {
          const metaChanged =
            n !== oldName ||
            sku.trim() !== oldSku ||
            (catResolved || "") !== oldCat.trim() ||
            u !== oldUnit ||
            (priceNum ?? null) !== (oldP ?? null) ||
            supplier.trim() !== oldSup ||
            note.trim() !== oldNote ||
            (nextImage ?? null) !== oldImg;

          if (metaChanged) {
            const movRef = doc(collection(firestore, "companies", companyId, "inventoryMovements"));
            tx.set(movRef, {
              companyId,
              type: "item_edit",
              itemId: item.id,
              itemName: n,
              quantity: 0,
              unit: u,
              date: today,
              note: "Úprava údajů položky",
              adjustmentDelta: null,
              supplier: null,
              documentNo: null,
              destination: null,
              productionId: null,
              productionTitle: null,
              createdAt: serverTimestamp(),
              createdBy: userId,
            });
          }
        }
      });

      toast({ title: "Uloženo", description: "Skladová položka byla aktualizována." });
      setPendingFile(null);
      onSaved();
      onOpenChange(false);
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

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-white border-slate-200 text-slate-900 max-w-lg max-h-[90vh] overflow-y-auto"
        data-portal-dialog
      >
        <DialogHeader>
          <DialogTitle>Upravit položku</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-start gap-4">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {thumbSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbSrc} alt="" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-400">
                  <ImageIcon className="h-10 w-10" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setPendingFile(f ?? null);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                Nahrát obrázek
              </Button>
              <p className="text-xs text-slate-500">PNG, JPG — uloží se po kliknutí na Uložit.</p>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Název</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-white" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Kód / SKU</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} className="bg-white" />
            </div>
            <div className="space-y-1">
              <Label>Jednotka</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} className="bg-white" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Kategorie</Label>
            <Select
              value={categoryId || "__none__"}
              onValueChange={(v) => setCategoryId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Vyberte kategorii…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Bez kategorie</SelectItem>
                {stockCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              Kategorie se spravují v modulu Sklad (kategorie lze řadit a filtrovat).
            </p>
          </div>

          <div className="space-y-1">
            <Label>Evidence zásoby</Label>
            <Select
              value={stockTrackingMode}
              onValueChange={(v) => setStockTrackingMode(v as InventoryStockTrackingMode)}
            >
              <SelectTrigger className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pieces">Kusy</SelectItem>
                <SelectItem value="length">Délka (řezivo / profily)</SelectItem>
                <SelectItem value="area">Plocha</SelectItem>
                <SelectItem value="mass">Hmotnost</SelectItem>
                <SelectItem value="generic">Obecná jednotka</SelectItem>
              </SelectContent>
            </Select>
            {stockTrackingMode === "length" ? (
              <p className="text-[11px] text-slate-500">
                Množství = aktuální dostupná délka v jednotce uvedené výše (např. mm). Při výdeji části zůstane
                rozdíl na skladě u téže položky.
              </p>
            ) : null}
          </div>

          {stockTrackingMode === "length" ? (
            <div className="space-y-1">
              <Label>Původní délka při naskladnění (volitelné)</Label>
              <Input
                className="bg-white"
                value={originalLengthInput}
                onChange={(e) => setOriginalLengthInput(e.target.value)}
                placeholder="např. 6000"
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{stockTrackingMode === "length" ? "Aktuální množství / délka" : "Množství"}</Label>
              <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} className="bg-white" />
            </div>
            <div className="space-y-1">
              <Label>Cena za jednotku (Kč)</Label>
              <Input
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="bg-white"
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Dodavatel</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} className="bg-white" />
          </div>
          <div className="space-y-1">
            <Label>Poznámka</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="bg-white min-h-[72px]" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
