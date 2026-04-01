"use client";

import React, { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useCollection, useCompany, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { ProductCatalogDoc, ProductCatalogProduct } from "@/lib/product-catalogs";

export default function ProductCatalogsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [selectionMode, setSelectionMode] = useState<"single" | "multi">("multi");
  const [activeCatalogId, setActiveCatalogId] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState("");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [newProductCategory, setNewProductCategory] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductNote, setNewProductNote] = useState("");
  const [newProductImage, setNewProductImage] = useState<File | null>(null);

  const catalogsRef = useMemoFirebase(
    () => (firestore && companyId ? query(collection(firestore, "companies", companyId, "product_catalogs")) : null),
    [firestore, companyId]
  );
  const { data: catalogsData } = useCollection(catalogsRef);

  const jobsRef = useMemoFirebase(
    () => (firestore && companyId ? query(collection(firestore, "companies", companyId, "jobs")) : null),
    [firestore, companyId]
  );
  const customersRef = useMemoFirebase(
    () => (firestore && companyId ? query(collection(firestore, "companies", companyId, "customers")) : null),
    [firestore, companyId]
  );
  const { data: jobsData } = useCollection(jobsRef);
  const { data: customersData } = useCollection(customersRef);

  const catalogs = useMemo(
    () => ((catalogsData ?? []) as Array<{ id: string } & Partial<ProductCatalogDoc>>).sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""), "cs")
    ),
    [catalogsData]
  );
  const activeCatalog =
    catalogs.find((c) => c.id === activeCatalogId) ?? (catalogs.length ? catalogs[0] : null);

  const createCatalog = async () => {
    if (!firestore || !companyId || !user?.uid || !newName.trim()) return;
    setSaving(true);
    try {
      const payload: ProductCatalogDoc = {
        companyId,
        name: newName.trim(),
        description: newDescription.trim(),
        category: newCategory.trim(),
        active: true,
        customerVisible: false,
        selectionMode,
        assignedJobIds: [],
        assignedCustomerIds: [],
        products: [],
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      };
      await addDoc(collection(firestore, "companies", companyId, "product_catalogs"), payload);
      setNewName("");
      setNewDescription("");
      setNewCategory("");
      toast({ title: "Katalog vytvořen" });
    } finally {
      setSaving(false);
    }
  };

  const toggleAssignment = async (
    catalogId: string,
    field: "assignedJobIds" | "assignedCustomerIds",
    value: string
  ) => {
    if (!firestore || !companyId || !user?.uid) return;
    const cat = catalogs.find((c) => c.id === catalogId);
    if (!cat) return;
    const list = new Set(Array.isArray(cat[field]) ? cat[field] : []);
    if (list.has(value)) list.delete(value);
    else list.add(value);
    await updateDoc(doc(firestore, "companies", companyId, "product_catalogs", catalogId), {
      [field]: Array.from(list),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  };

  const updateCatalogFlags = async (catalogId: string, patch: Partial<ProductCatalogDoc>) => {
    if (!firestore || !companyId || !user?.uid) return;
    await updateDoc(doc(firestore, "companies", companyId, "product_catalogs", catalogId), {
      ...patch,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  };

  const addProduct = async () => {
    if (!firestore || !companyId || !user?.uid || !activeCatalog || !newProductName.trim()) return;
    setSaving(true);
    try {
      let imageUrl = "";
      if (newProductImage) {
        const storage = getFirebaseStorage();
        const ext = newProductImage.name.split(".").pop() || "jpg";
        const path = `companies/${companyId}/catalog-products/${activeCatalog.id}/${Date.now()}.${ext}`;
        const uploaded = await uploadBytes(ref(storage, path), newProductImage);
        imageUrl = await getDownloadURL(uploaded.ref);
      }
      const products = Array.isArray(activeCatalog.products) ? [...activeCatalog.products] : [];
      const product: ProductCatalogProduct = {
        id: `prod_${Date.now()}`,
        name: newProductName.trim(),
        description: newProductDescription.trim(),
        category: newProductCategory.trim(),
        note: newProductNote.trim(),
        imageUrl: imageUrl || undefined,
        price: newProductPrice.trim() ? Number(newProductPrice) : null,
        gallery: [],
        order: products.length,
        active: true,
      };
      products.push(product);
      await updateDoc(doc(firestore, "companies", companyId, "product_catalogs", activeCatalog.id), {
        products,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      setNewProductName("");
      setNewProductDescription("");
      setNewProductCategory("");
      setNewProductPrice("");
      setNewProductNote("");
      setNewProductImage(null);
      toast({ title: "Produkt přidán" });
    } finally {
      setSaving(false);
    }
  };

  const removeProduct = async (catalogId: string, productId: string) => {
    if (!firestore || !companyId || !user?.uid) return;
    const cat = catalogs.find((c) => c.id === catalogId);
    if (!cat) return;
    const products = (cat.products ?? []).filter((p) => p.id !== productId);
    await updateDoc(doc(firestore, "companies", companyId, "product_catalogs", catalogId), {
      products,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  };

  const reorderProduct = async (catalogId: string, productId: string, dir: -1 | 1) => {
    if (!firestore || !companyId || !user?.uid) return;
    const cat = catalogs.find((c) => c.id === catalogId);
    if (!cat) return;
    const products = [...(cat.products ?? [])];
    const idx = products.findIndex((p) => p.id === productId);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= products.length) return;
    const tmp = products[idx];
    products[idx] = products[to];
    products[to] = tmp;
    const normalized = products.map((p, i) => ({ ...p, order: i }));
    await updateDoc(doc(firestore, "companies", companyId, "product_catalogs", catalogId), {
      products: normalized,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  };

  const editProduct = async (catalogId: string, productId: string) => {
    if (!firestore || !companyId || !user?.uid) return;
    const cat = catalogs.find((c) => c.id === catalogId);
    if (!cat) return;
    const products = [...(cat.products ?? [])];
    const idx = products.findIndex((p) => p.id === productId);
    if (idx < 0) return;
    const base = products[idx];
    const nextName = window.prompt("Název produktu", base.name ?? "") ?? base.name;
    const nextDesc = window.prompt("Popis produktu", base.description ?? "") ?? base.description;
    products[idx] = { ...base, name: String(nextName), description: String(nextDesc ?? "") };
    await updateDoc(doc(firestore, "companies", companyId, "product_catalogs", catalogId), {
      products,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Produktové katalogy</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Název katalogu</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Např. Kuchyně 2026" />
          </div>
          <div>
            <Label>Kategorie</Label>
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Kuchyně / Dveře / Okna…" />
          </div>
          <div className="md:col-span-2">
            <Label>Popis</Label>
            <Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <Label>Režim výběru</Label>
            <div className="mt-2 flex gap-2">
              <Button type="button" variant={selectionMode === "single" ? "default" : "outline"} onClick={() => setSelectionMode("single")}>Single select</Button>
              <Button type="button" variant={selectionMode === "multi" ? "default" : "outline"} onClick={() => setSelectionMode("multi")}>Multi select</Button>
            </div>
          </div>
          <div className="flex items-end">
            <Button type="button" disabled={saving || !newName.trim()} onClick={() => void createCatalog()}>
              Vytvořit katalog
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Seznam katalogů</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!catalogs.length ? <p className="text-sm text-muted-foreground">Zatím žádný katalog.</p> : null}
            {catalogs.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`w-full rounded border p-2 text-left ${activeCatalog?.id === c.id ? "border-primary bg-primary/5" : "border-border"}`}
                onClick={() => setActiveCatalogId(c.id)}
              >
                <p className="font-medium">{c.name || "Bez názvu"}</p>
                <p className="text-xs text-muted-foreground">{c.category || "Bez kategorie"}</p>
              </button>
            ))}
          </CardContent>
        </Card>

        {activeCatalog ? (
          <Card>
            <CardHeader>
              <CardTitle>{activeCatalog.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={activeCatalog.active !== false}
                    onCheckedChange={(v) => void updateCatalogFlags(activeCatalog.id, { active: v })}
                  />
                  Aktivní
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={activeCatalog.customerVisible === true}
                    onCheckedChange={(v) => void updateCatalogFlags(activeCatalog.id, { customerVisible: v })}
                  />
                  Viditelné pro zákazníka
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded border p-3">
                  <p className="mb-2 text-sm font-medium">Přiřazení k zakázce</p>
                  <div className="max-h-44 space-y-1 overflow-auto pr-1">
                    {(jobsData ?? []).map((j) => (
                      <label key={j.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={(activeCatalog.assignedJobIds ?? []).includes(j.id)}
                          onChange={() => void toggleAssignment(activeCatalog.id, "assignedJobIds", j.id)}
                        />
                        {String((j as { name?: string }).name ?? j.id)}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rounded border p-3">
                  <p className="mb-2 text-sm font-medium">Přiřazení k zákazníkovi</p>
                  <div className="max-h-44 space-y-1 overflow-auto pr-1">
                    {(customersData ?? []).map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={(activeCatalog.assignedCustomerIds ?? []).includes(c.id)}
                          onChange={() => void toggleAssignment(activeCatalog.id, "assignedCustomerIds", c.id)}
                        />
                        {String((c as { companyName?: string; email?: string }).companyName ?? (c as { email?: string }).email ?? c.id)}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded border p-3">
                <p className="mb-2 text-sm font-medium">Přidat produkt</p>
                <div className="grid gap-2 md:grid-cols-2">
                  <Input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="Název produktu" />
                  <Input value={newProductCategory} onChange={(e) => setNewProductCategory(e.target.value)} placeholder="Kategorie" />
                  <Input value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} placeholder="Cena (volitelné)" />
                  <Input type="file" accept="image/*" onChange={(e) => setNewProductImage(e.target.files?.[0] ?? null)} />
                  <Textarea className="md:col-span-2" value={newProductDescription} onChange={(e) => setNewProductDescription(e.target.value)} placeholder="Popis" rows={2} />
                  <Textarea className="md:col-span-2" value={newProductNote} onChange={(e) => setNewProductNote(e.target.value)} placeholder="Poznámka" rows={2} />
                </div>
                <Button className="mt-2" type="button" disabled={saving || !newProductName.trim()} onClick={() => void addProduct()}>
                  Přidat produkt
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(activeCatalog.products ?? []).map((p) => (
                  <div key={p.id} className="rounded border p-3">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={p.name} className="mb-2 h-40 w-full rounded object-cover" />
                    ) : null}
                    <p className="font-medium">{p.name}</p>
                    {p.description ? <p className="text-sm text-muted-foreground">{p.description}</p> : null}
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => void editProduct(activeCatalog.id, p.id)}>
                        Upravit
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void reorderProduct(activeCatalog.id, p.id, -1)}>
                        Nahoru
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void reorderProduct(activeCatalog.id, p.id, 1)}>
                        Dolů
                      </Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => void removeProduct(activeCatalog.id, p.id)}>
                        Smazat
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

