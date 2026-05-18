"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  collection,
  query,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { Paperclip, X, Loader2, Image as ImageIcon } from "lucide-react";
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  attachmentRefKey,
  INQUIRY_OFFER_LIBRARY_COLLECTION,
  parseInquiryOfferLibraryDoc,
  type InquiryOfferAttachmentRef,
  type InquiryOfferLibraryItem,
} from "@/lib/inquiry-offer-attachments";
import { buildProductGalleryUrls, type ProductCatalogProduct } from "@/lib/product-catalogs";
import type { InventoryItemRow } from "@/lib/inventory-types";

type Props = {
  companyId: string;
  attachments: InquiryOfferAttachmentRef[];
  onChange: (next: InquiryOfferAttachmentRef[]) => void;
  uploadSessionId: string;
};

function newAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function InquiryOfferAttachmentsField(props: Props) {
  const firestore = useFirestore();
  const storage = getFirebaseStorage();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<
    { catalogId: string; catalogName: string; product: ProductCatalogProduct }[]
  >([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const libraryQ = useMemoFirebase(() => {
    if (!firestore || !props.companyId) return null;
    return query(
      collection(firestore, "companies", props.companyId, INQUIRY_OFFER_LIBRARY_COLLECTION),
      orderBy("sortOrder", "asc")
    );
  }, [firestore, props.companyId]);

  const inventoryQ = useMemoFirebase(() => {
    if (!firestore || !props.companyId) return null;
    return collection(firestore, "companies", props.companyId, "inventoryItems");
  }, [firestore, props.companyId]);

  const { data: libraryRaw } = useCollection(libraryQ);
  const { data: inventoryRaw } = useCollection(inventoryQ);

  const library = useMemo((): InquiryOfferLibraryItem[] => {
    const list = Array.isArray(libraryRaw) ? libraryRaw : [];
    const out: InquiryOfferLibraryItem[] = [];
    for (const d of list) {
      const row = d as Record<string, unknown> & { id?: string };
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const item = parseInquiryOfferLibraryDoc(id, row);
      if (item.active !== false) out.push(item);
    }
    return out;
  }, [libraryRaw]);

  const inventoryItems = useMemo(() => {
    const list = Array.isArray(inventoryRaw) ? inventoryRaw : [];
    return list
      .map((d) => d as InventoryItemRow & { id?: string })
      .filter((x) => x.id && String(x.imageUrl ?? "").trim());
  }, [inventoryRaw]);

  const existingKeys = useMemo(
    () => new Set(props.attachments.map(attachmentRefKey)),
    [props.attachments]
  );

  const addRef = (refItem: InquiryOfferAttachmentRef) => {
    if (existingKeys.has(attachmentRefKey(refItem))) return;
    props.onChange([...props.attachments, refItem]);
  };

  const removeRef = (id: string) => {
    props.onChange(props.attachments.filter((a) => a.id !== id));
  };

  const loadCatalogs = async () => {
    if (!firestore || !props.companyId) return;
    setCatalogLoading(true);
    try {
      const snap = await getDocs(
        collection(firestore, "companies", props.companyId, "product_catalogs")
      );
      const rows: typeof catalogProducts = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const name = String(data.name ?? "Katalog").trim();
        const products = Array.isArray(data.products) ? data.products : [];
        for (const p of products) {
          const prod = p as ProductCatalogProduct;
          const urls = buildProductGalleryUrls(prod);
          if (urls.length === 0) continue;
          rows.push({ catalogId: docSnap.id, catalogName: name, product: prod });
        }
      });
      setCatalogProducts(rows);
    } catch {
      toast({ variant: "destructive", title: "Katalogy se nepodařilo načíst." });
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files?.length || !storage || !props.companyId) return;
    setUploading(true);
    try {
      const added: InquiryOfferAttachmentRef[] = [];
      for (const file of Array.from(files).slice(0, 5)) {
        const id = newAttachmentId();
        const safeName = file.name.replace(/[^\w.\-()+]/g, "_").slice(0, 120);
        const path = `companies/${props.companyId}/inquiry-offer-uploads/${props.uploadSessionId}/${id}-${safeName}`;
        const sref = ref(storage, path);
        await uploadBytes(sref, file, { contentType: file.type || undefined });
        const url = await getDownloadURL(sref);
        added.push({
          id,
          source: "upload",
          filename: file.name,
          contentType: file.type || null,
          sizeBytes: file.size,
          storagePath: path,
          downloadUrl: url,
        });
      }
      props.onChange([...props.attachments, ...added]);
      toast({ title: `Přidáno ${added.length} příloh` });
      setPickerOpen(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nahrání se nezdařilo",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm font-medium">Přílohy</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => {
            setPickerOpen(true);
            void loadCatalogs();
          }}
        >
          <Paperclip className="h-4 w-4" />
          Přidat přílohu
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        multiple
        onChange={(e) => void handleUploadFiles(e.target.files)}
      />
      {props.attachments.length > 0 ? (
        <ul className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50/80 p-2">
          {props.attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{a.filename}</span>
                <span className="text-slate-500"> · {a.source}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => removeRef(a.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Žádné přílohy.</p>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-lg flex-col overflow-hidden p-0">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>Přidat přílohu</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="library" className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
              <TabsTrigger value="library">Knihovna</TabsTrigger>
              <TabsTrigger value="upload">Nahrát</TabsTrigger>
              <TabsTrigger value="catalog">Katalog</TabsTrigger>
              <TabsTrigger value="inventory">Sklad</TabsTrigger>
            </TabsList>
            <TabsContent value="library" className="mt-3 max-h-[50vh] overflow-y-auto">
              {library.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Knihovna je prázdná. Nahrajte soubory v Nastavení → Přílohy k nabídkám.
                </p>
              ) : (
                <ul className="space-y-1">
                  {library.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          addRef({
                            id: newAttachmentId(),
                            source: "library",
                            filename: item.name,
                            contentType: item.contentType,
                            sizeBytes: item.sizeBytes,
                            storagePath: item.storagePath,
                            downloadUrl: item.downloadUrl,
                            sourceId: item.id,
                            label: item.name,
                          });
                          setPickerOpen(false);
                        }}
                      >
                        {item.name}
                        {item.category ? (
                          <span className="text-xs text-slate-500"> · {item.category}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="upload" className="mt-3 space-y-3">
              <Button
                type="button"
                className="w-full"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                Vybrat soubory z počítače
              </Button>
            </TabsContent>
            <TabsContent value="catalog" className="mt-3 max-h-[50vh] overflow-y-auto">
              {catalogLoading ? (
                <p className="text-sm text-slate-500">Načítám produkty…</p>
              ) : catalogProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Žádné produkty s obrázkem.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {catalogProducts.map(({ catalogName, product }) => {
                    const url = buildProductGalleryUrls(product)[0];
                    const name = String(product.name ?? "Produkt").trim();
                    return (
                      <li key={`${catalogName}-${product.id ?? name}`}>
                        <button
                          type="button"
                          className="flex w-full flex-col overflow-hidden rounded-md border border-slate-200 text-left hover:ring-2 hover:ring-orange-300"
                          onClick={() => {
                            addRef({
                              id: newAttachmentId(),
                              source: "catalog",
                              filename: `${name}.jpg`,
                              contentType: "image/jpeg",
                              downloadUrl: url,
                              sourceId: String(product.id ?? ""),
                              label: name,
                            });
                            setPickerOpen(false);
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="" className="aspect-square w-full object-cover" />
                          <span className="truncate px-1 py-1 text-[10px]">{name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="inventory" className="mt-3 max-h-[50vh] overflow-y-auto">
              {inventoryItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Žádné položky skladu s fotografií.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {inventoryItems.map((item) => {
                    const url = String(item.imageUrl ?? "").trim();
                    const name = String(item.name ?? item.sku ?? "Položka").trim();
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="flex w-full flex-col overflow-hidden rounded-md border border-slate-200 text-left hover:ring-2 hover:ring-orange-300"
                          onClick={() => {
                            addRef({
                              id: newAttachmentId(),
                              source: "inventory",
                              filename: `${name}.jpg`,
                              contentType: "image/jpeg",
                              downloadUrl: url,
                              sourceId: item.id,
                              label: name,
                            });
                            setPickerOpen(false);
                          }}
                        >
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt="" className="aspect-square w-full object-cover" />
                          ) : (
                            <div className="flex aspect-square items-center justify-center bg-slate-100">
                              <ImageIcon className="h-8 w-8 text-slate-400" />
                            </div>
                          )}
                          <span className="truncate px-1 py-1 text-[10px]">{name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
