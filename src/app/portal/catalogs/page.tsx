"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  getDocs,
  query,
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
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { usePortalPermissionsOptional } from "@/contexts/portal-permissions-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText } from "lucide-react";
import type {
  JobProductSelectionDoc,
  ProductCatalogDoc,
  ProductCatalogPdfAttachment,
  ProductCatalogProduct,
} from "@/lib/product-catalogs";
import { CatalogPdfAttachmentsSection } from "@/components/catalogs/catalog-pdf-attachments-section";
import {
  buildProductGalleryUrls,
  serializePdfAttachmentsForFirestore,
  serializeProductForFirestore,
} from "@/lib/product-catalogs";
import { catalogAuthUserMessage } from "@/lib/product-catalogs/catalog-auth-diagnostics";
import type { CatalogAuthDiagnostic } from "@/lib/product-catalogs/catalog-auth-diagnostics";
import {
  collectProductImageStoragePaths,
  planCatalogProductDeletion,
} from "@/lib/product-catalogs/product-delete";

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
  const access = usePortalModuleAccess("productCatalogs");
  const portalPerms = usePortalPermissionsOptional();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !user || !companyId) return;
    console.info("[ProductCatalogs] UI access", {
      uid: user.uid,
      companyId,
      canRead: access.canRead,
      canWrite: access.canWrite,
      effectiveProductCatalogs: portalPerms?.permissions.productCatalogs ?? null,
    });
  }, [user, companyId, access.canRead, access.canWrite, portalPerms?.permissions.productCatalogs]);
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
    pdfAttachments: ProductCatalogPdfAttachment[];
  } | null>(null);
  const [productFormNewFiles, setProductFormNewFiles] = useState<File[]>([]);
  const [catalogDialogTab, setCatalogDialogTab] = useState<"settings" | "documents">("settings");
  const [productDocsPreview, setProductDocsPreview] = useState<{
    catalogId: string;
    product: ProductCatalogProduct;
  } | null>(null);

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

  const patchCatalogApi = async (catalogId: string, patch: Record<string, unknown>) => {
    if (!user || !companyId) {
      throw new Error("Nejste přihlášeni nebo chybí organizace.");
    }
    const token = await user.getIdToken();
    const res = await fetch(`/api/company/product-catalogs/${encodeURIComponent(catalogId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ companyId, ...patch }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      detail?: string;
      diagnostic?: CatalogAuthDiagnostic;
    };
    if (process.env.NODE_ENV === "development") {
      console.log("[ProductCatalogs] API PATCH response", { status: res.status, data });
    }
    if (!res.ok || !data.ok) {
      if (process.env.NODE_ENV === "development" && data.diagnostic) {
        console.warn("[ProductCatalogs] autorizace — diagnostika", data.diagnostic);
      }
      const diag = data.diagnostic;
      const msg =
        diag && !diag.authorized
          ? catalogAuthUserMessage(diag, res.status)
          : data.error ??
            (res.status === 403
              ? "Nemáte oprávnění k úpravě produktových katalogů (vyžadován Zápis)."
              : "Uložení katalogu selhalo.");
      const detail = typeof data.detail === "string" ? data.detail.trim() : "";
      throw new Error(detail && process.env.NODE_ENV === "development" ? `${msg} (${detail})` : msg);
    }
  };

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
    if (!companyId || !user?.uid) return;
    const payload: Record<string, unknown> = { ...patch };
    if (Array.isArray(patch.products)) {
      payload.products = patch.products.map((p) => {
        const row = { ...(p as ProductCatalogProduct) };
        if (row.archivedAt && typeof row.archivedAt === "object" && "seconds" in (row.archivedAt as object)) {
          row.archivedAt = new Date().toISOString();
        }
        return serializeProductForFirestore(row);
      });
    }
    if (Array.isArray(patch.pdfAttachments)) {
      payload.pdfAttachments = serializePdfAttachmentsForFirestore(patch.pdfAttachments);
    }
    const saveData = omitUndefinedKeys(payload);
    if (process.env.NODE_ENV === "development") {
      console.log("[ProductCatalogs] SAVE DATA (API)", saveData);
    }
    await patchCatalogApi(catalogId, saveData);
    if (successToastTitle !== false) {
      toast({ title: successToastTitle ?? "Katalog byl uložen" });
    }
  };

  const createCatalog = async () => {
    if (!companyId || !user?.uid || !newName.trim()) return;
    setSaving(true);
    try {
      let coverImageUrl = "";
      if (newCoverImage) {
        [coverImageUrl] = await uploadImages([newCoverImage], `companies/${companyId}/catalog-covers`);
      }
      const token = await user.getIdToken();
      const res = await fetch("/api/company/product-catalogs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          omitUndefinedKeys({
            companyId,
            name: newName.trim(),
            description: newDescription.trim(),
            category: newCategory.trim(),
            ...(coverImageUrl.trim() ? { coverImageUrl } : {}),
            order: catalogs.length,
            selectionMode,
            products: [],
          })
        ),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; diagnostic?: Record<string, unknown> };
      if (!res.ok || !data.ok) {
        if (process.env.NODE_ENV === "development" && data.diagnostic) {
          console.warn("[ProductCatalogs] create auth diagnostic", data.diagnostic);
        }
        throw new Error(data.error ?? "Vytvoření katalogu selhalo.");
      }
      setNewName("");
      setNewDescription("");
      setNewCategory("");
      setNewCoverImage(null);
      toast({ title: "Katalog byl uložen" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Katalog se nepodařilo vytvořit",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const reorderCatalog = async (catalogId: string, dir: -1 | 1) => {
    if (!companyId || !user?.uid) return;
    const arr = [...catalogs];
    const idx = arr.findIndex((c) => c.id === catalogId);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    const tmp = arr[idx];
    arr[idx] = arr[to];
    arr[to] = tmp;
    try {
      await Promise.all(arr.map((c, i) => patchCatalogApi(c.id, { order: i })));
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Pořadí katalogů se nepodařilo uložit",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const safeDeleteCatalog = async (catalog: CatalogRow) => {
    if (!companyId || !user?.uid) return;
    if (!window.confirm("Opravdu smazat katalog? Bude archivován (soft delete).")) return;
    let hasSelections = false;
    if (firestore) {
      try {
        const cg = query(
          collectionGroup(firestore, "product_catalog_selections"),
          where("companyId", "==", companyId),
          where("catalogId", "==", catalog.id)
        );
        const selectionsSnap = await getDocs(cg);
        hasSelections = !selectionsSnap.empty;
      } catch (e) {
        console.warn("[ProductCatalogs] catalog selection lookup failed", e);
      }
    }
    try {
      await updateCatalog(
        catalog.id,
        {
          archived: true,
          active: false,
          customerVisible: false,
          deletedAt: new Date().toISOString(),
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
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Katalog se nepodařilo smazat",
        description: e instanceof Error ? e.message : String(e),
      });
    }
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
      await updateCatalog(activeCatalog.id, { products: productsCurrent }, "Produkt byl uložen");
      setNewProductName("");
      setNewProductShortDescription("");
      setNewProductDescription("");
      setNewProductCategory("");
      setNewProductPrice("");
      setNewProductNote("");
      setNewProductInternalNote("");
      setNewProductImages([]);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Produkt se nepodařilo uložit",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const updateProduct = async (
    catalogId: string,
    productId: string,
    patch: Partial<ProductCatalogProduct>,
    successToastTitle?: string | false
  ) => {
    const cat = catalogs.find((c) => c.id === catalogId);
    if (!cat) return;
    const next = [...(cat.products ?? [])].map((p) => (p.id === productId ? { ...p, ...patch } : p));
    await updateCatalog(catalogId, { products: next }, successToastTitle ?? "Produkt byl uložen");
  };

  const bestEffortDeleteProductStorage = async (product: ProductCatalogProduct) => {
    const paths = collectProductImageStoragePaths(product);
    if (!paths.length) return;
    try {
      const storage = getFirebaseStorage();
      for (const path of paths) {
        try {
          await deleteObject(ref(storage, path));
        } catch (e) {
          const code =
            e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
          if (code === "storage/object-not-found") continue;
          console.warn("[ProductCatalogs] storage delete skipped", { path, code });
        }
      }
    } catch (e) {
      console.warn("[ProductCatalogs] bestEffortDeleteProductStorage", e);
    }
  };

  const lookupProductHasHistoricalSelection = async (
    catalogId: string,
    productId: string
  ): Promise<boolean> => {
    if (!firestore || !companyId) return false;
    try {
      const cg = query(
        collectionGroup(firestore, "product_catalog_selections"),
        where("companyId", "==", companyId),
        where("catalogId", "==", catalogId)
      );
      const snap = await getDocs(cg);
      let found = false;
      snap.forEach((d) => {
        const data = d.data() as Partial<JobProductSelectionDoc>;
        if ((data.selectedProductIds ?? []).includes(productId)) found = true;
      });
      return found;
    } catch (e) {
      console.warn("[ProductCatalogs] selection lookup failed — delete continues", e);
      return false;
    }
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
    if (!companyId || !user?.uid) {
      toast({
        variant: "destructive",
        title: "Produkt nelze smazat",
        description: "Nejste přihlášeni nebo chybí organizace.",
      });
      return;
    }
    if (!access.canWrite) return;
    if (!window.confirm("Opravdu smazat produkt? Tuto akci lze u historických výběrů zákazníka zrušit jen archivací.")) {
      return;
    }
    const cat = catalogs.find((c) => c.id === catalogId);
    if (!cat) {
      toast({
        variant: "destructive",
        title: "Produkt nelze smazat",
        description: "Katalog nebyl nalezen. Obnovte stránku.",
      });
      return;
    }
    setSaving(true);
    try {
      const hasHistoricalSelection = await lookupProductHasHistoricalSelection(catalogId, product.id);
      const plan = planCatalogProductDeletion(cat.products ?? [], product.id, hasHistoricalSelection);
      await updateCatalog(catalogId, { products: plan.products }, false);
      void bestEffortDeleteProductStorage(product);
      toast({
        title: "Produkt byl úspěšně smazán",
        description:
          plan.mode === "archive"
            ? "Produkt byl archivován kvůli historickým výběrům zákazníka."
            : "Produkt byl odstraněn z katalogu.",
      });
    } catch (e) {
      console.error("[ProductCatalogs] deleteProductSafely", e);
      toast({
        variant: "destructive",
        title: "Produkt se nepodařilo smazat",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
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
    setCatalogDialogTab("settings");
    setCatalogDialogOpen(true);
  };

  const persistProductPdfAttachments = async (
    sourceCatalogId: string,
    productId: string,
    pdfAttachments: ProductCatalogPdfAttachment[]
  ) => {
    const srcCat = catalogs.find((c) => c.id === sourceCatalogId);
    const current = srcCat?.products?.find((x) => x.id === productId);
    if (!srcCat || !current) {
      throw new Error("Produkt v katalogu nebyl nalezen. Obnovte stránku a zkuste znovu.");
    }
    const nextProducts = (srcCat.products ?? []).map((x) =>
      x.id === productId ? { ...current, pdfAttachments } : x
    );
    await updateCatalog(sourceCatalogId, { products: nextProducts }, false);
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
      pdfAttachments: Array.isArray(p.pdfAttachments) ? [...p.pdfAttachments] : [],
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
        pdfAttachments: productForm.pdfAttachments,
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
        await patchCatalogApi(productFormSourceCatalogId, {
          products: fromProducts.map((p) => serializeProductForFirestore(p)),
        });
        await patchCatalogApi(tgtId, {
          products: toProducts.map((p) => serializeProductForFirestore(p)),
        });
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

  if (!access.canRead) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert variant="destructive">
          <AlertTitle>Bez oprávnění</AlertTitle>
          <AlertDescription>K modulu Produktové katalogy nemáte přístup.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4">
      {!access.canWrite ? (
        <Alert>
          <AlertTitle>Režim náhledu</AlertTitle>
          <AlertDescription>
            Můžete prohlížet katalogy a produkty. Úpravy, nahrávání obrázků a mazání vyžadují oprávnění Zápis.
          </AlertDescription>
        </Alert>
      ) : null}
      {access.canWrite ? (
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
      ) : null}

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
                {access.canWrite ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="secondary" onClick={() => openCatalogDialog(c)}>
                    Upravit katalog
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void reorderCatalog(c.id, -1)}>Nahoru</Button>
                  <Button size="sm" variant="outline" onClick={() => void reorderCatalog(c.id, 1)}>Dolů</Button>
                  <Button size="sm" variant="destructive" onClick={() => void safeDeleteCatalog(c)}>Smazat</Button>
                </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        {activeCatalog ? (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <CardTitle>Detail katalogu</CardTitle>
              {access.canWrite ? (
              <Button type="button" size="sm" onClick={() => openCatalogDialog()}>
                Upravit katalog
              </Button>
              ) : null}
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

              {companyId && activeCatalog.id ? (
                <CatalogPdfAttachmentsSection
                  companyId={companyId}
                  catalogId={activeCatalog.id}
                  sectionTitle="Dokumenty katalogu"
                  attachments={Array.isArray(activeCatalog.pdfAttachments) ? activeCatalog.pdfAttachments : []}
                  canWrite={access.canWrite}
                  onPersist={
                    access.canWrite
                      ? async (next) => {
                          await updateCatalog(activeCatalog.id, { pdfAttachments: next }, false);
                        }
                      : undefined
                  }
                />
              ) : null}

              {access.canWrite ? (
              <>
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
              </>
              ) : null}

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
                          {(p.pdfAttachments?.length ?? 0) > 0 ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 text-orange-700 hover:underline dark:text-orange-400"
                              title="Dokumenty produktu"
                              onClick={() =>
                                setProductDocsPreview({ catalogId: activeCatalog.id, product: p })
                              }
                            >
                              <FileText className="h-3.5 w-3.5" aria-hidden />
                              {p.pdfAttachments?.length ?? 0}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1 sm:flex-col">
                        {(p.pdfAttachments?.length ?? 0) > 0 ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setProductDocsPreview({ catalogId: activeCatalog.id, product: p })
                            }
                          >
                            Dokumenty
                          </Button>
                        ) : null}
                      {access.canWrite ? (
                        <>
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
                        </>
                      ) : null}
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
        <DialogContent className="max-h-[min(92dvh,720px)] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upravit katalog</DialogTitle>
          </DialogHeader>
          {catalogForm && editingCatalogId && companyId ? (
            <Tabs
              value={catalogDialogTab}
              onValueChange={(v) => setCatalogDialogTab(v === "documents" ? "documents" : "settings")}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="settings">Nastavení</TabsTrigger>
                <TabsTrigger value="documents">Dokumenty</TabsTrigger>
              </TabsList>
              <TabsContent value="settings" className="mt-3">
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
              </TabsContent>
              <TabsContent value="documents" className="mt-3">
                <CatalogPdfAttachmentsSection
                  companyId={companyId}
                  catalogId={editingCatalogId}
                  sectionTitle="PDF dokumenty katalogu"
                  attachments={
                    Array.isArray(
                      catalogs.find((c) => c.id === editingCatalogId)?.pdfAttachments
                    )
                      ? (catalogs.find((c) => c.id === editingCatalogId)!
                          .pdfAttachments as ProductCatalogPdfAttachment[])
                      : []
                  }
                  canWrite={access.canWrite}
                  onPersist={
                    access.canWrite
                      ? async (next) => {
                          await updateCatalog(editingCatalogId, { pdfAttachments: next }, false);
                        }
                      : undefined
                  }
                />
              </TabsContent>
            </Tabs>
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
              {companyId && productFormSourceCatalogId ? (
                <CatalogPdfAttachmentsSection
                  companyId={companyId}
                  catalogId={productForm.targetCatalogId}
                  productId={productForm.id}
                  sectionTitle="Dokumenty produktu"
                  attachments={productForm.pdfAttachments}
                  canWrite={access.canWrite}
                  onChange={(pdfAttachments) =>
                    setProductForm((prev) => (prev ? { ...prev, pdfAttachments } : prev))
                  }
                  onPersist={
                    access.canWrite && productFormSourceCatalogId
                      ? async (pdfAttachments) => {
                          setProductForm((prev) => (prev ? { ...prev, pdfAttachments } : prev));
                          await persistProductPdfAttachments(
                            productFormSourceCatalogId,
                            productForm.id,
                            pdfAttachments
                          );
                        }
                      : undefined
                  }
                />
              ) : null}
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

      <Dialog
        open={productDocsPreview != null}
        onOpenChange={(open) => {
          if (!open) setProductDocsPreview(null);
        }}
      >
        <DialogContent className="max-h-[min(88dvh,640px)] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {productDocsPreview?.product.name ?? "Produkt"} — dokumenty
            </DialogTitle>
          </DialogHeader>
          {productDocsPreview && companyId ? (
            <CatalogPdfAttachmentsSection
              companyId={companyId}
              catalogId={productDocsPreview.catalogId}
              productId={productDocsPreview.product.id}
              sectionTitle="Dokumenty produktu"
              attachments={(() => {
                const cat = catalogs.find((c) => c.id === productDocsPreview.catalogId);
                const live = cat?.products?.find((x) => x.id === productDocsPreview.product.id);
                return Array.isArray(live?.pdfAttachments)
                  ? live.pdfAttachments
                  : Array.isArray(productDocsPreview.product.pdfAttachments)
                    ? productDocsPreview.product.pdfAttachments
                    : [];
              })()}
              canWrite={access.canWrite}
              onPersist={
                access.canWrite
                  ? async (pdfAttachments) => {
                      await persistProductPdfAttachments(
                        productDocsPreview.catalogId,
                        productDocsPreview.product.id,
                        pdfAttachments
                      );
                      setProductDocsPreview((prev) =>
                        prev ? { ...prev, product: { ...prev.product, pdfAttachments } } : prev
                      );
                    }
                  : undefined
              }
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProductDocsPreview(null)}>
              Zavřít
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

