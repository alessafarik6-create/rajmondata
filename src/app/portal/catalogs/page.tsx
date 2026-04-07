"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import type { JobProductSelectionDoc, ProductCatalogDoc, ProductCatalogProduct } from "@/lib/product-catalogs";
import {
  buildProductGalleryUrls,
  serializeProductForFirestore,
} from "@/lib/product-catalogs";

type CatalogRow = { id: string } & Partial<ProductCatalogDoc>;

/** Jednotné čtení viditelnosti pro zákazníka (boolean v DB + kompatibilita se staršími zápisy). */
function readCustomerVisibleFlag(raw: unknown): boolean {
  if (raw === true) return true;
  if (raw === false) return false;
  if (raw === "true" || raw === 1) return true;
  if (raw === "false" || raw === 0) return false;
  return false;
}

/** Firestore nepovoluje hodnoty `undefined` uvnitř update/add dat. */
function omitUndefinedKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

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
  const [newProductShortDescription, setNewProductShortDescription] = useState("");
  const [newProductCategory, setNewProductCategory] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductNote, setNewProductNote] = useState("");
  const [newProductInternalNote, setNewProductInternalNote] = useState("");
  const [newProductImages, setNewProductImages] = useState<File[]>([]);

  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false);
  /** Katalog, jehož úprava je v dialogu — nesmí se měnit při přepnutí výběru v postranním seznamu. */
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [catalogForm, setCatalogForm] = useState<{
    name: string;
    description: string;
    category: string;
    order: string;
    active: boolean;
    customerVisible: boolean;
    selectionMode: "single" | "multi";
  } | null>(null);
  const [catalogCoverFile, setCatalogCoverFile] = useState<File | null>(null);

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [productFormSourceCatalogId, setProductFormSourceCatalogId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<{
    id: string;
    targetCatalogId: string;
    name: string;
    shortDescription: string;
    description: string;
    category: string;
    price: string;
    note: string;
    internalNote: string;
    order: string;
    active: boolean;
    imageUrl?: string;
    gallery: string[];
  } | null>(null);
  const [productFormNewFiles, setProductFormNewFiles] = useState<File[]>([]);

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

  useEffect(() => {
    if (!activeCatalogId && catalogs[0]?.id) {
      setActiveCatalogId(catalogs[0].id);
    }
  }, [activeCatalogId, catalogs]);

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

  const updateCatalog = async (
    catalogId: string,
    patch: Partial<ProductCatalogDoc>,
    successToastTitle?: string | false
  ) => {
    if (!firestore || !companyId || !user?.uid) return;
    const payload: Record<string, unknown> = {
      ...patch,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    };
    if (Array.isArray(patch.products)) {
      payload.products = patch.products.map((p) =>
        serializeProductForFirestore(p as ProductCatalogProduct)
      );
    }
    const saveData = omitUndefinedKeys(payload);
    if (process.env.NODE_ENV === "development") {
      if (Object.values(saveData).includes(undefined)) {
        console.warn("[ProductCatalogs] SAVE DATA: neočekávané undefined po sanitizaci", saveData);
      }
      console.log("[ProductCatalogs] SAVE DATA", saveData);
    }
    await updateDoc(
      doc(firestore, "companies", companyId, "product_catalogs", catalogId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Firestore update payload z mapovaných produktů
      saveData as any
    );
    if (successToastTitle !== false) {
      toast({ title: successToastTitle ?? "Katalog byl uložen" });
    }
  };

  const createCatalog = async () => {
    if (!firestore || !companyId || !user?.uid || !newName.trim()) return;
    setSaving(true);
    try {
      let coverImageUrl = "";
      if (newCoverImage) {
        [coverImageUrl] = await uploadImages([newCoverImage], `companies/${companyId}/catalog-covers`);
      }
      const newCatalogPayload = omitUndefinedKeys({
        companyId,
        name: newName.trim(),
        description: newDescription.trim(),
        category: newCategory.trim(),
        ...(coverImageUrl.trim() ? { coverImageUrl } : {}),
        active: true,
        customerVisible: false,
        archived: false,
        order: catalogs.length,
        selectionMode,
        assignedJobIds: [] as string[],
        assignedCustomerIds: [] as string[],
        products: [] as ProductCatalogProduct[],
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      if (process.env.NODE_ENV === "development") {
        console.log("[ProductCatalogs] SAVE DATA (create catalog)", newCatalogPayload);
      }
      await addDoc(
        collection(firestore, "companies", companyId, "product_catalogs"),
        newCatalogPayload as Parameters<typeof addDoc>[1]
      );
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
    await updateCatalog(
      catalog.id,
      {
        archived: true,
        active: false,
        customerVisible: false,
        deletedAt: serverTimestamp(),
        assignedCustomerIds: [],
        assignedJobIds: [],
      },
      false
    );
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
        shortDescription: newProductShortDescription.trim() || undefined,
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
      setNewProductShortDescription("");
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
    await updateCatalog(catalogId, { products: next }, "Produkt byl uložen");
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
    await updateCatalog(catalogId, { products: normalized }, "Pořadí produktů uloženo");
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

  const openCatalogDialog = (cat?: CatalogRow) => {
    const c = cat ?? activeCatalog;
    if (!c?.id) return;
    if (cat) setActiveCatalogId(cat.id);
    setEditingCatalogId(c.id);
    setCatalogForm({
      name: c.name ?? "",
      description: c.description ?? "",
      category: c.category ?? "",
      order: String(c.order ?? 0),
      active: c.active !== false,
      customerVisible: readCustomerVisibleFlag(c.customerVisible),
      selectionMode: c.selectionMode === "single" ? "single" : "multi",
    });
    setCatalogCoverFile(null);
    setCatalogDialogOpen(true);
  };

  const saveCatalogDialog = async () => {
    const catalogRow = editingCatalogId ? catalogs.find((x) => x.id === editingCatalogId) : undefined;
    if (!editingCatalogId || !catalogRow || !catalogForm || !companyId || !user?.uid) return;
    setSaving(true);
    try {
      let coverImageUrl = catalogRow.coverImageUrl;
      if (catalogCoverFile) {
        const [url] = await uploadImages([catalogCoverFile], `companies/${companyId}/catalog-covers`);
        coverImageUrl = url;
      }
      const orderNum = Number.parseInt(catalogForm.order, 10);
      await updateCatalog(editingCatalogId, {
        name: catalogForm.name.trim(),
        description: catalogForm.description.trim() || undefined,
        category: catalogForm.category.trim() || undefined,
        order: Number.isFinite(orderNum) ? orderNum : catalogRow.order ?? 0,
        active: catalogForm.active === true,
        customerVisible: catalogForm.customerVisible === true,
        selectionMode: catalogForm.selectionMode,
        coverImageUrl: coverImageUrl || undefined,
      });
      setCatalogDialogOpen(false);
      setCatalogCoverFile(null);
      setEditingCatalogId(null);
    } catch (e) {
      console.error("[ProductCatalogsPage] saveCatalogDialog", e);
      toast({
        variant: "destructive",
        title: "Katalog se nepodařilo uložit",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const openProductDialog = (sourceCatalogId: string, p: ProductCatalogProduct) => {
    setProductFormSourceCatalogId(sourceCatalogId);
    const galleryUrls = buildProductGalleryUrls(p);
    setProductForm({
      id: p.id,
      targetCatalogId: sourceCatalogId,
      name: p.name ?? "",
      shortDescription: p.shortDescription ?? "",
      description: p.description ?? "",
      category: p.category ?? "",
      price: typeof p.price === "number" ? String(p.price) : "",
      note: p.note ?? "",
      internalNote: p.internalNote ?? "",
      order: String(p.order ?? 0),
      active: p.active !== false,
      imageUrl: galleryUrls[0] ?? p.imageUrl,
      gallery: galleryUrls,
    });
    setProductFormNewFiles([]);
    setProductDialogOpen(true);
  };

  const saveProductDialog = async () => {
    if (!productForm || !productFormSourceCatalogId || !firestore || !companyId || !user?.uid) return;
    setSaving(true);
    try {
      const srcCat = catalogs.find((c) => c.id === productFormSourceCatalogId);
      if (!srcCat) {
        toast({ variant: "destructive", title: "Zdrojový katalog nebyl nalezen." });
        return;
      }
      const productList = Array.isArray(srcCat.products) ? srcCat.products : [];
      const current = productList.find((x) => x.id === productForm.id);
      if (!current) {
        toast({
          variant: "destructive",
          title: "Produkt v katalogu nebyl nalezen",
          description: "Obnovte stránku a zkuste znovu.",
        });
        return;
      }

      let newUrls: string[] = [];
      if (productFormNewFiles.length) {
        newUrls = await uploadImages(
          productFormNewFiles,
          `companies/${companyId}/catalog-products/${productForm.targetCatalogId}`
        );
      }

      const mergedGallery = [...new Set([...productForm.gallery, ...newUrls].filter(Boolean))];
      const preferredMain =
        typeof productForm.imageUrl === "string" && productForm.imageUrl.trim()
          ? productForm.imageUrl.trim()
          : mergedGallery[0];
      let nextImageUrl =
        preferredMain && mergedGallery.includes(preferredMain) ? preferredMain : mergedGallery[0];

      const priceTrim = productForm.price.trim();
      let priceVal: number | null = null;
      if (priceTrim !== "") {
        const n = Number(priceTrim);
        priceVal = Number.isFinite(n) ? n : null;
      }

      const updated: ProductCatalogProduct = {
        ...current,
        name: productForm.name.trim(),
        shortDescription: productForm.shortDescription.trim() ? productForm.shortDescription.trim() : undefined,
        description: productForm.description.trim() ? productForm.description.trim() : undefined,
        category: productForm.category.trim() ? productForm.category.trim() : undefined,
        price: priceVal,
        note: productForm.note.trim() ? productForm.note.trim() : undefined,
        internalNote: productForm.internalNote.trim() ? productForm.internalNote.trim() : undefined,
        order: Number.parseInt(productForm.order, 10) || 0,
        active: productForm.active,
        gallery: mergedGallery,
        imageUrl: nextImageUrl,
      };

      const tgtId = productForm.targetCatalogId;
      if (productFormSourceCatalogId === tgtId) {
        const next = productList.map((x) => (x.id === updated.id ? updated : x));
        await updateCatalog(tgtId, { products: next }, "Produkt byl uložen");
      } else {
        const tgtCat = catalogs.find((c) => c.id === tgtId);
        if (!tgtCat) {
          toast({ variant: "destructive", title: "Cílový katalog nebyl nalezen." });
          return;
        }
        const fromProducts = productList.filter((x) => x.id !== updated.id);
        const toProducts = [...(Array.isArray(tgtCat.products) ? tgtCat.products : [])];
        const visible = toProducts.filter((x) => x.archived !== true);
        const moved: ProductCatalogProduct = {
          ...updated,
          order: visible.length,
        };
        toProducts.push(moved);
        await updateDoc(doc(firestore, "companies", companyId, "product_catalogs", productFormSourceCatalogId), {
          products: fromProducts.map((p) => serializeProductForFirestore(p)),
          updatedBy: user.uid,
          updatedAt: serverTimestamp(),
        } as any);
        await updateDoc(doc(firestore, "companies", companyId, "product_catalogs", tgtId), {
          products: toProducts.map((p) => serializeProductForFirestore(p)),
          updatedBy: user.uid,
          updatedAt: serverTimestamp(),
        } as any);
        toast({ title: "Produkt byl přesunut a uložen" });
        const prevSourceCatalogId = productFormSourceCatalogId;
        setProductDialogOpen(false);
        setProductForm(null);
        setProductFormNewFiles([]);
        setProductFormSourceCatalogId(null);
        if (activeCatalogId === prevSourceCatalogId) {
          setActiveCatalogId(tgtId);
        }
        return;
      }

      setProductDialogOpen(false);
      setProductForm(null);
      setProductFormNewFiles([]);
      setProductFormSourceCatalogId(null);
    } catch (e) {
      console.error("[ProductCatalogsPage] saveProductDialog", e);
      toast({
        variant: "destructive",
        title: "Produkt se nepodařilo uložit",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const removeProductPhotoFromForm = async (url: string) => {
    if (!productForm) return;
    if (!window.confirm("Odstranit fotku z produktu?")) return;
    const nextGallery = productForm.gallery.filter((u) => u !== url);
    const nextImage =
      productForm.imageUrl === url ? nextGallery[0] || undefined : productForm.imageUrl;
    setProductForm({ ...productForm, gallery: nextGallery, imageUrl: nextImage });
    try {
      const storage = getFirebaseStorage();
      await deleteObject(ref(storage, url));
      toast({ title: "Fotka odstraněna (uložte produkt)" });
    } catch (e) {
      console.warn("[ProductCatalogsPage] removeProductPhotoFromForm deleteObject", e);
      toast({
        variant: "destructive",
        title: "Soubor ve Storage se nepodařilo smazat",
        description:
          "Obrázek byl odebrán z formuláře. U externích URL se Storage nemazal; po uložení může soubor zůstat v úložišti.",
      });
    }
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
                  <Button size="sm" variant="secondary" onClick={() => openCatalogDialog(c)}>
                    Upravit katalog
                  </Button>
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
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <CardTitle>Detail katalogu</CardTitle>
              <Button type="button" size="sm" onClick={() => openCatalogDialog()}>
                Upravit katalog
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row">
                <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-md bg-muted sm:h-24 sm:w-36">
                  {activeCatalog.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activeCatalog.coverImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      Bez titulního obrázku
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-lg font-semibold">{activeCatalog.name || "Bez názvu"}</p>
                  {activeCatalog.category ? (
                    <p className="text-sm text-muted-foreground">{activeCatalog.category}</p>
                  ) : null}
                  {activeCatalog.description ? (
                    <p className="line-clamp-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                      {activeCatalog.description}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Bez popisu</p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
                    <span>{activeCatalog.active !== false ? "Aktivní" : "Neaktivní"}</span>
                    <span>·</span>
                    <span>
                      {readCustomerVisibleFlag(activeCatalog.customerVisible)
                        ? "Viditelné pro zákazníka"
                        : "Skryté pro zákazníka"}
                    </span>
                    <span>·</span>
                    <span>{activeCatalog.selectionMode === "multi" ? "Multi výběr" : "Jedna položka"}</span>
                  </div>
                </div>
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
                  <Input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length) setNewProductImages((prev) => [...prev, ...files]);
                      e.target.value = "";
                    }}
                  />
                  <Input
                    className="md:col-span-2"
                    value={newProductShortDescription}
                    onChange={(e) => setNewProductShortDescription(e.target.value)}
                    placeholder="Krátký popisek (pro seznam u zákazníka)"
                  />
                  <Textarea className="md:col-span-2" value={newProductDescription} onChange={(e) => setNewProductDescription(e.target.value)} placeholder="Popis" rows={2} />
                  <Textarea className="md:col-span-2" value={newProductNote} onChange={(e) => setNewProductNote(e.target.value)} placeholder="Poznámka pro zákazníka" rows={2} />
                  <Textarea className="md:col-span-2" value={newProductInternalNote} onChange={(e) => setNewProductInternalNote(e.target.value)} placeholder="Interní poznámka (jen admin)" rows={2} />
                </div>
                <Button className="mt-2" type="button" disabled={saving || !newProductName.trim()} onClick={() => void addProduct()}>
                  Přidat produkt
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Produkty v katalogu</p>
                <div className="grid gap-2">
                  {products.map((p) => {
                    const listThumb = p.imageUrl || p.gallery?.[0];
                    return (
                    <div
                      key={p.id}
                      className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
                    >
                      <div className="relative h-20 w-full shrink-0 overflow-hidden rounded-md bg-muted sm:h-20 sm:w-20">
                        {listThumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={listThumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                            —
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">{p.name}</p>
                        {(p.shortDescription ?? "").trim() ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {p.shortDescription}
                          </p>
                        ) : (p.description ?? "").trim() ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {p.description}
                          </p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {typeof p.price === "number" ? (
                            <span className="font-semibold text-foreground">
                              {p.price.toLocaleString("cs-CZ")} Kč
                            </span>
                          ) : null}
                          <span>{p.active !== false ? "Aktivní" : "Skrytý"}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1 sm:flex-col">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => openProductDialog(activeCatalog.id, p)}
                        >
                          Upravit produkt
                        </Button>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="outline" onClick={() => void reorderProduct(activeCatalog.id, p.id, -1)}>
                            ↑
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void reorderProduct(activeCatalog.id, p.id, 1)}>
                            ↓
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => void deleteProductSafely(activeCatalog.id, p)}>
                            Smazat
                          </Button>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog
        open={catalogDialogOpen}
        onOpenChange={(open) => {
          setCatalogDialogOpen(open);
          if (!open) {
            setEditingCatalogId(null);
            setCatalogCoverFile(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upravit katalog</DialogTitle>
          </DialogHeader>
          {catalogForm ? (
            <div className="grid gap-3 py-2">
              <div>
                <Label>Název</Label>
                <Input
                  value={catalogForm.name || ""}
                  onChange={(e) =>
                    setCatalogForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                  }
                />
              </div>
              <div>
                <Label>Popis</Label>
                <Textarea
                  rows={4}
                  value={catalogForm.description || ""}
                  onChange={(e) =>
                    setCatalogForm((prev) => (prev ? { ...prev, description: e.target.value } : prev))
                  }
                  className="min-h-[100px] leading-relaxed"
                />
              </div>
              <div>
                <Label>Kategorie</Label>
                <Input
                  value={catalogForm.category}
                  onChange={(e) =>
                    setCatalogForm((prev) => (prev ? { ...prev, category: e.target.value } : prev))
                  }
                />
              </div>
              <div>
                <Label>Pořadí (číslo)</Label>
                <Input
                  value={catalogForm.order || ""}
                  onChange={(e) =>
                    setCatalogForm((prev) => (prev ? { ...prev, order: e.target.value } : prev))
                  }
                  inputMode="numeric"
                />
              </div>
              <div>
                <Label>Nový titulní obrázek</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setCatalogCoverFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={catalogForm.active}
                  onCheckedChange={(v) =>
                    setCatalogForm((prev) => (prev ? { ...prev, active: v } : prev))
                  }
                />
                Aktivní
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={catalogForm.customerVisible}
                  onCheckedChange={(v) =>
                    setCatalogForm((prev) => (prev ? { ...prev, customerVisible: v === true } : prev))
                  }
                />
                Viditelné pro zákazníka
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={catalogForm.selectionMode === "multi"}
                  onCheckedChange={(v) =>
                    setCatalogForm((prev) =>
                      prev ? { ...prev, selectionMode: v ? "multi" : "single" } : prev
                    )
                  }
                />
                Více položek (multi)
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCatalogDialogOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={saving || !catalogForm?.name.trim()} onClick={() => void saveCatalogDialog()}>
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={productDialogOpen}
        onOpenChange={(open) => {
          setProductDialogOpen(open);
          if (!open) {
            setProductForm(null);
            setProductFormNewFiles([]);
            setProductFormSourceCatalogId(null);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Upravit produkt</DialogTitle>
          </DialogHeader>
          {productForm ? (
            <div className="grid max-h-[min(70dvh,32rem)] gap-3 overflow-y-auto py-2 pr-1">
              <div>
                <Label>Katalog</Label>
                <Select
                  value={productForm.targetCatalogId}
                  onValueChange={(v) => setProductForm({ ...productForm, targetCatalogId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Katalog" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogs.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name || c.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Název</Label>
                <Input
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Krátký popisek</Label>
                <Input
                  value={productForm.shortDescription}
                  onChange={(e) => setProductForm({ ...productForm, shortDescription: e.target.value })}
                  placeholder="Zobrazí se v seznamu u zákazníka"
                />
              </div>
              <div>
                <Label>Popis</Label>
                <Textarea
                  rows={5}
                  value={productForm.description}
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  className="min-h-[120px] leading-relaxed"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label>Kategorie</Label>
                  <Input
                    value={productForm.category}
                    onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Cena (Kč)</Label>
                  <Input
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
              </div>
              <div>
                <Label>Pořadí</Label>
                <Input
                  value={productForm.order}
                  onChange={(e) => setProductForm({ ...productForm, order: e.target.value })}
                  inputMode="numeric"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={productForm.active}
                  onCheckedChange={(v) => setProductForm({ ...productForm, active: v })}
                />
                Aktivní / viditelný
              </label>
              <div>
                <Label>Poznámka pro zákazníka</Label>
                <Textarea
                  rows={2}
                  value={productForm.note}
                  onChange={(e) => setProductForm({ ...productForm, note: e.target.value })}
                />
              </div>
              <div>
                <Label>Interní poznámka</Label>
                <Textarea
                  rows={2}
                  value={productForm.internalNote}
                  onChange={(e) => setProductForm({ ...productForm, internalNote: e.target.value })}
                />
              </div>
              <div>
                <Label>Přidat obrázky</Label>
                <Input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) {
                      setProductFormNewFiles((prev) => [...prev, ...files]);
                    }
                    e.target.value = "";
                  }}
                />
              </div>
              {productForm.gallery.length ? (
                <div>
                  <Label className="mb-2 block">Galerie</Label>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {productForm.gallery.map((u) => (
                      <div key={u} className="space-y-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt="" className="h-16 w-full rounded object-cover" />
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 flex-1 px-1 text-[10px]"
                            onClick={() => setProductForm({ ...productForm, imageUrl: u })}
                          >
                            Hlavní
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="h-7 px-1 text-[10px]"
                            onClick={() => void removeProductPhotoFromForm(u)}
                          >
                            ×
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProductDialogOpen(false)}>
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={saving || !productForm?.name.trim()}
              onClick={() => void saveProductDialog()}
            >
              Uložit produkt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

