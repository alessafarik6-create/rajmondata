"use client";

import React, { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useCollection, useCompany, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { JobProductSelectionDoc, ProductCatalogDoc, ProductCatalogProduct } from "@/lib/product-catalogs";

type CatalogRow = { id: string } & Partial<ProductCatalogDoc>;

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
  const [newCoverImage, setNewCoverImage] = useState<File | null>(null);
  const [activeCatalogId, setActiveCatalogId] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState("");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [newProductCategory, setNewProductCategory] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductNote, setNewProductNote] = useState("");
  const [newProductInternalNote, setNewProductInternalNote] = useState("");
  const [newProductImages, setNewProductImages] = useState<File[]>([]);

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

  const catalogs = useMemo(() => {
    const rows = (catalogsData ?? []) as CatalogRow[];
    const list = rows
      .filter((c) => c.archived !== true)
      .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || String(a.name ?? "").localeCompare(String(b.name ?? ""), "cs"));
    if (process.env.NODE_ENV === "development") console.log("catalogs", list);
    return list;
  }, [catalogsData]);
  const activeCatalog = catalogs.find((c) => c.id === activeCatalogId) ?? (catalogs[0] ?? null);
  const products = useMemo(
    () =>
      [...(activeCatalog?.products ?? [])]
        .filter((p) => p.archived !== true)
        .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999)),
    [activeCatalog]
  );
  if (process.env.NODE_ENV === "development") {
    console.log("catalog products", products);
    console.log("product images", products.map((p) => ({ id: p.id, imageUrl: p.imageUrl, gallery: p.gallery ?? [] })));
  }

  const uploadImages = async (files: File[], pathPrefix: string) => {
    const storage = getFirebaseStorage();
    const urls: string[] = [];
    for (const file of files) {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${pathPrefix}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const uploaded = await uploadBytes(ref(storage, path), file);
      urls.push(await getDownloadURL(uploaded.ref));
    }
    return urls;
  };

  const updateCatalog = async (catalogId: string, patch: Partial<ProductCatalogDoc>) => {
    if (!firestore || !companyId || !user?.uid) return;
    await updateDoc(doc(firestore, "companies", companyId, "product_catalogs", catalogId), {
      ...patch,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    toast({ title: "Katalog byl uložen" });
  };

  const createCatalog = async () => {
    if (!firestore || !companyId || !user?.uid || !newName.trim()) return;
    setSaving(true);
    try {
      let coverImageUrl = "";
      if (newCoverImage) {
        [coverImageUrl] = await uploadImages([newCoverImage], `companies/${companyId}/catalog-covers`);
      }
      await addDoc(collection(firestore, "companies", companyId, "product_catalogs"), {
        companyId,
        name: newName.trim(),
        description: newDescription.trim(),
        category: newCategory.trim(),
        coverImageUrl: coverImageUrl || undefined,
        active: true,
        customerVisible: false,
        archived: false,
        order: catalogs.length,
        selectionMode,
        assignedJobIds: [],
        assignedCustomerIds: [],
        products: [],
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      } satisfies ProductCatalogDoc);
      setNewName("");
      setNewDescription("");
      setNewCategory("");
      setNewCoverImage(null);
      toast({ title: "Katalog byl uložen" });
    } finally {
      setSaving(false);
    }
  };

  const reorderCatalog = async (catalogId: string, dir: -1 | 1) => {
    if (!firestore || !companyId || !user?.uid) return;
    const arr = [...catalogs];
    const idx = arr.findIndex((c) => c.id === catalogId);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    const tmp = arr[idx];
    arr[idx] = arr[to];
    arr[to] = tmp;
    await Promise.all(
      arr.map((c, i) =>
        updateDoc(doc(firestore, "companies", companyId, "product_catalogs", c.id), {
          order: i,
          updatedBy: user.uid,
          updatedAt: serverTimestamp(),
        })
      )
    );
  };

  const safeDeleteCatalog = async (catalog: CatalogRow) => {
    if (!firestore || !companyId || !user?.uid) return;
    if (!window.confirm("Opravdu smazat katalog? Bude archivován (soft delete).")) return;
    const cg = query(
      collectionGroup(firestore, "product_catalog_selections"),
      where("companyId", "==", companyId),
      where("catalogId", "==", catalog.id)
    );
    const selectionsSnap = await getDocs(cg);
    const hasSelections = !selectionsSnap.empty;
    await updateCatalog(catalog.id, {
      archived: true,
      active: false,
      customerVisible: false,
      deletedAt: serverTimestamp(),
      assignedCustomerIds: [],
      assignedJobIds: [],
    });
    toast({
      title: hasSelections ? "Katalog byl bezpečně archivován" : "Katalog byl archivován",
      description: hasSelections
        ? "Katalog má historické výběry, proto nebyl tvrdě smazán."
        : "Katalog je skrytý a neaktivní.",
    });
  };

  const toggleAssignment = async (
    catalogId: string,
    field: "assignedJobIds" | "assignedCustomerIds",
    value: string
  ) => {
    const cat = catalogs.find((c) => c.id === catalogId);
    if (!cat) return;
    const list = new Set(Array.isArray(cat[field]) ? cat[field] : []);
    if (list.has(value)) list.delete(value);
    else list.add(value);
    await updateCatalog(catalogId, { [field]: Array.from(list) } as Partial<ProductCatalogDoc>);
  };

  const addProduct = async () => {
    if (!firestore || !companyId || !user?.uid || !activeCatalog || !newProductName.trim()) return;
    setSaving(true);
    try {
      const urls = await uploadImages(newProductImages, `companies/${companyId}/catalog-products/${activeCatalog.id}`);
      const productsCurrent = Array.isArray(activeCatalog.products) ? [...activeCatalog.products] : [];
      const product: ProductCatalogProduct = {
        id: `prod_${Date.now()}`,
        name: newProductName.trim(),
        description: newProductDescription.trim(),
        category: newProductCategory.trim(),
        note: newProductNote.trim(),
        internalNote: newProductInternalNote.trim(),
        imageUrl: urls[0] || undefined,
        gallery: urls,
        price: newProductPrice.trim() ? Number(newProductPrice) : null,
        order: productsCurrent.length,
        active: true,
        archived: false,
      };
      productsCurrent.push(product);
      await updateCatalog(activeCatalog.id, { products: productsCurrent });
      setNewProductName("");
      setNewProductDescription("");
      setNewProductCategory("");
      setNewProductPrice("");
      setNewProductNote("");
      setNewProductInternalNote("");
      setNewProductImages([]);
      toast({ title: "Produkt byl uložen" });
    } finally {
      setSaving(false);
    }
  };

  const updateProduct = async (catalogId: string, productId: string, patch: Partial<ProductCatalogProduct>) => {
    const cat = catalogs.find((c) => c.id === catalogId);
    if (!cat) return;
    const next = [...(cat.products ?? [])].map((p) => (p.id === productId ? { ...p, ...patch } : p));
    await updateCatalog(catalogId, { products: next });
    toast({ title: "Produkt byl uložen" });
  };

  const reorderProduct = async (catalogId: string, productId: string, dir: -1 | 1) => {
    const cat = catalogs.find((c) => c.id === catalogId);
    if (!cat) return;
    const arr = [...(cat.products ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = arr.findIndex((p) => p.id === productId);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    const tmp = arr[idx];
    arr[idx] = arr[to];
    arr[to] = tmp;
    const normalized = arr.map((p, i) => ({ ...p, order: i }));
    await updateCatalog(catalogId, { products: normalized });
  };

  const deleteProductSafely = async (catalogId: string, product: ProductCatalogProduct) => {
    if (!firestore || !companyId) return;
    if (!window.confirm("Opravdu smazat produkt? Bude bezpečně archivován.")) return;
    const cg = query(
      collectionGroup(firestore, "product_catalog_selections"),
      where("companyId", "==", companyId),
      where("catalogId", "==", catalogId)
    );
    const snap = await getDocs(cg);
    let isSelected = false;
    snap.forEach((d) => {
      const data = d.data() as Partial<JobProductSelectionDoc>;
      if ((data.selectedProductIds ?? []).includes(product.id)) isSelected = true;
    });
    await updateProduct(catalogId, product.id, {
      active: false,
      archived: true,
      archivedAt: serverTimestamp(),
    });
    toast({
      title: "Produkt byl smazán",
      description: isSelected
        ? "Produkt byl archivován, historické výběry zůstaly zachované."
        : "Produkt je nyní archivovaný.",
    });
  };

  const uploadProductGallery = async (catalogId: string, product: ProductCatalogProduct, files: FileList | null) => {
    if (!files || !files.length || !companyId) return;
    const urls = await uploadImages(Array.from(files), `companies/${companyId}/catalog-products/${catalogId}`);
    const nextGallery = [...(product.gallery ?? []), ...urls];
    await updateProduct(catalogId, product.id, {
      gallery: nextGallery,
      imageUrl: product.imageUrl || nextGallery[0] || undefined,
    });
    toast({ title: "Fotka byla nahrána" });
  };

  const removeProductPhoto = async (catalogId: string, product: ProductCatalogProduct, url: string) => {
    if (!window.confirm("Odstranit fotku z produktu?")) return;
    const nextGallery = (product.gallery ?? []).filter((u) => u !== url);
    const nextImage = product.imageUrl === url ? nextGallery[0] || undefined : product.imageUrl;
    await updateProduct(catalogId, product.id, { gallery: nextGallery, imageUrl: nextImage });
    try {
      const storage = getFirebaseStorage();
      await deleteObject(ref(storage, url));
    } catch {
      // URL may be external; ignore.
    }
    toast({ title: "Fotka byla odstraněna" });
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
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div>
            <Label>Kategorie</Label>
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Popis</Label>
            <Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <Label>Cover image</Label>
            <Input type="file" accept="image/*" onChange={(e) => setNewCoverImage(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label>Režim výběru</Label>
            <div className="mt-2 flex gap-2">
              <Button type="button" variant={selectionMode === "single" ? "default" : "outline"} onClick={() => setSelectionMode("single")}>Single</Button>
              <Button type="button" variant={selectionMode === "multi" ? "default" : "outline"} onClick={() => setSelectionMode("multi")}>Multi</Button>
            </div>
          </div>
          <div className="md:col-span-2">
            <Button type="button" disabled={saving || !newName.trim()} onClick={() => void createCatalog()}>
              Vytvořit katalog
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[360px,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Seznam katalogů</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {catalogs.map((c) => (
              <div key={c.id} className={`rounded border p-2 ${activeCatalog?.id === c.id ? "border-primary bg-primary/5" : ""}`}>
                <button type="button" className="w-full text-left" onClick={() => setActiveCatalogId(c.id)}>
                  <p className="font-medium">{c.name || "Bez názvu"}</p>
                  <p className="text-xs text-muted-foreground">{c.category || "Bez kategorie"}</p>
                </button>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => void reorderCatalog(c.id, -1)}>Nahoru</Button>
                  <Button size="sm" variant="outline" onClick={() => void reorderCatalog(c.id, 1)}>Dolů</Button>
                  <Button size="sm" variant="destructive" onClick={() => void safeDeleteCatalog(c)}>Smazat</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {activeCatalog ? (
          <Card>
            <CardHeader>
              <CardTitle>Detail katalogu</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 md:grid-cols-2">
                <Input value={activeCatalog.name ?? ""} onChange={(e) => void updateCatalog(activeCatalog.id, { name: e.target.value })} placeholder="Název" />
                <Input value={activeCatalog.category ?? ""} onChange={(e) => void updateCatalog(activeCatalog.id, { category: e.target.value })} placeholder="Kategorie" />
                <Textarea className="md:col-span-2" value={activeCatalog.description ?? ""} onChange={(e) => void updateCatalog(activeCatalog.id, { description: e.target.value })} />
              </div>
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-sm"><Switch checked={activeCatalog.active !== false} onCheckedChange={(v) => void updateCatalog(activeCatalog.id, { active: v })} />Aktivní</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={activeCatalog.customerVisible === true} onCheckedChange={(v) => void updateCatalog(activeCatalog.id, { customerVisible: v })} />Viditelné pro zákazníka</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={activeCatalog.selectionMode === "multi"} onCheckedChange={(v) => void updateCatalog(activeCatalog.id, { selectionMode: v ? "multi" : "single" })} />Multi select</label>
              </div>
              <div>
                <Label>Cover image</Label>
                <Input type="file" accept="image/*" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !companyId) return;
                  const [url] = await uploadImages([file], `companies/${companyId}/catalog-covers`);
                  await updateCatalog(activeCatalog.id, { coverImageUrl: url });
                }} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded border p-3">
                  <p className="mb-2 text-sm font-medium">Přiřazení k zakázce</p>
                  <div className="max-h-44 space-y-1 overflow-auto pr-1">
                    {(jobsData ?? []).map((j) => (
                      <label key={j.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={(activeCatalog.assignedJobIds ?? []).includes(j.id)} onChange={() => void toggleAssignment(activeCatalog.id, "assignedJobIds", j.id)} />
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
                        <input type="checkbox" checked={(activeCatalog.assignedCustomerIds ?? []).includes(c.id)} onChange={() => void toggleAssignment(activeCatalog.id, "assignedCustomerIds", c.id)} />
                        {String((c as { companyName?: string; email?: string }).companyName ?? (c as { email?: string }).email ?? c.id)}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded border p-3">
                <p className="mb-2 text-sm font-medium">Přidat produkt</p>
                <div className="grid gap-2 md:grid-cols-2">
                  <Input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="Název" />
                  <Input value={newProductCategory} onChange={(e) => setNewProductCategory(e.target.value)} placeholder="Kategorie" />
                  <Input value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} placeholder="Cena" />
                  <Input type="file" accept="image/*" multiple onChange={(e) => setNewProductImages(Array.from(e.target.files ?? []))} />
                  <Textarea className="md:col-span-2" value={newProductDescription} onChange={(e) => setNewProductDescription(e.target.value)} placeholder="Popis" rows={2} />
                  <Textarea className="md:col-span-2" value={newProductNote} onChange={(e) => setNewProductNote(e.target.value)} placeholder="Poznámka pro zákazníka" rows={2} />
                  <Textarea className="md:col-span-2" value={newProductInternalNote} onChange={(e) => setNewProductInternalNote(e.target.value)} placeholder="Interní poznámka (jen admin)" rows={2} />
                </div>
                <Button className="mt-2" type="button" disabled={saving || !newProductName.trim()} onClick={() => void addProduct()}>
                  Přidat produkt
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {products.map((p) => (
                  <div key={p.id} className="rounded border p-3">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={p.name} className="mb-2 h-36 w-full rounded object-cover" />
                    ) : null}
                    <Input value={p.name} onChange={(e) => void updateProduct(activeCatalog.id, p.id, { name: e.target.value })} className="mb-1" />
                    <Textarea value={p.description ?? ""} onChange={(e) => void updateProduct(activeCatalog.id, p.id, { description: e.target.value })} rows={2} className="mb-1" />
                    <Input value={p.category ?? ""} onChange={(e) => void updateProduct(activeCatalog.id, p.id, { category: e.target.value })} className="mb-1" />
                    <Input value={String(p.price ?? "")} onChange={(e) => void updateProduct(activeCatalog.id, p.id, { price: e.target.value.trim() ? Number(e.target.value) : null })} className="mb-1" />
                    <Textarea value={p.note ?? ""} onChange={(e) => void updateProduct(activeCatalog.id, p.id, { note: e.target.value })} rows={2} className="mb-1" placeholder="Poznámka pro zákazníka" />
                    <Textarea value={p.internalNote ?? ""} onChange={(e) => void updateProduct(activeCatalog.id, p.id, { internalNote: e.target.value })} rows={2} placeholder="Interní poznámka" />
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={() => void reorderProduct(activeCatalog.id, p.id, -1)}>↑</Button>
                      <Button size="sm" variant="outline" onClick={() => void reorderProduct(activeCatalog.id, p.id, 1)}>↓</Button>
                      <Button size="sm" variant="outline" onClick={() => void updateProduct(activeCatalog.id, p.id, { active: !(p.active !== false) })}>
                        {p.active !== false ? "Skrýt" : "Aktivovat"}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => void deleteProductSafely(activeCatalog.id, p)}>Smazat</Button>
                    </div>
                    <div className="mt-2">
                      <Input type="file" accept="image/*" multiple onChange={(e) => void uploadProductGallery(activeCatalog.id, p, e.target.files)} />
                    </div>
                    {!!p.gallery?.length ? (
                      <div className="mt-2 grid grid-cols-4 gap-1">
                        {p.gallery.map((u) => (
                          <div key={u} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt="" className="h-14 w-full rounded object-cover" />
                            <div className="mt-1 flex gap-1">
                              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void updateProduct(activeCatalog.id, p.id, { imageUrl: u })}>Hlavní</Button>
                              <Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" onClick={() => void removeProductPhoto(activeCatalog.id, p, u)}>X</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
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

