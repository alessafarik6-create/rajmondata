"use client";

import React, { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CatalogPdfViewerDialog } from "@/components/catalogs/catalog-pdf-viewer-dialog";
import {
  CatalogPdfThumbnail,
  createInstantPdfThumbnailFromFile,
} from "@/components/catalogs/catalog-pdf-thumbnail";
import type { ProductCatalogPdfAttachment } from "@/lib/product-catalogs";
import {
  PRODUCT_CATALOG_PDF_MAX_BYTES,
  buildCatalogLevelPdfStoragePath,
  buildProductLevelPdfStoragePath,
  serializePdfAttachmentsForFirestore,
} from "@/lib/product-catalogs";
import { Trash2 } from "lucide-react";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import { useToast } from "@/hooks/use-toast";
import { CatalogPdfLoadError, loadCatalogPdfBytes } from "@/lib/product-catalog-pdf-client";

async function isPdfFile(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
}

export type CatalogPdfAttachmentsSectionProps = {
  companyId: string;
  catalogId: string;
  productId?: string;
  attachments: ProductCatalogPdfAttachment[];
  canWrite: boolean;
  customerMode?: boolean;
  sectionTitle?: string;
  onPersist?: (next: ProductCatalogPdfAttachment[]) => Promise<void>;
  onChange?: (next: ProductCatalogPdfAttachment[]) => void;
};

export function CatalogPdfAttachmentsSection({
  companyId,
  catalogId,
  productId,
  attachments,
  canWrite,
  customerMode = false,
  sectionTitle,
  onPersist,
  onChange,
}: CatalogPdfAttachmentsSectionProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<ProductCatalogPdfAttachment | null>(null);
  const [instantThumbs, setInstantThumbs] = useState<Record<string, string>>({});

  const heading =
    sectionTitle ?? (productId ? "Dokumenty produktu" : "Dokumenty katalogu");

  const openPreview = (att: ProductCatalogPdfAttachment) => {
    setPreviewAtt(att);
  };

  const applyChange = useCallback(
    async (next: ProductCatalogPdfAttachment[], successMessage?: string) => {
      const serialized = serializePdfAttachmentsForFirestore(next);
      onChange?.(serialized);
      if (onPersist) {
        try {
          await onPersist(serialized);
          if (successMessage) toast({ title: successMessage });
        } catch (e) {
          toast({
            variant: "destructive",
            title: "PDF se nepodařilo uložit",
            description: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }
      }
    },
    [onChange, onPersist, toast]
  );

  const uploadSingleFile = async (
    file: File,
    currentList: ProductCatalogPdfAttachment[]
  ): Promise<ProductCatalogPdfAttachment> => {
    if (file.size > PRODUCT_CATALOG_PDF_MAX_BYTES) {
      throw new Error(`Soubor „${file.name}" je větší než 25 MB.`);
    }
    if (!(await isPdfFile(file))) {
      throw new Error(`Soubor „${file.name}" není platné PDF.`);
    }
    const docId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const storagePath = productId
      ? buildProductLevelPdfStoragePath(companyId, catalogId, productId, docId)
      : buildCatalogLevelPdfStoragePath(companyId, catalogId, docId);
    const storage = getFirebaseStorage();
    const uploaded = await uploadBytes(ref(storage, storagePath), file, {
      contentType: "application/pdf",
    });
    const downloadUrl = await getDownloadURL(uploaded.ref);
    const row: ProductCatalogPdfAttachment = {
      id: docId,
      fileName: file.name,
      displayName: file.name.replace(/\.pdf$/i, ""),
      storagePath,
      downloadUrl,
      mimeType: "application/pdf",
      sizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
      customerVisible: false,
    };
    try {
      const thumbUrl = await createInstantPdfThumbnailFromFile(file);
      setInstantThumbs((prev) => ({ ...prev, [docId]: thumbUrl }));
    } catch (e) {
      console.warn("[CatalogPdfAttachments] instant thumbnail failed", e);
    }
    return row;
  };

  const uploadFiles = async (files: File[]) => {
    if (!canWrite || customerMode || !files.length) return;
    setUploading(true);
    let acc = attachments;
    let okCount = 0;
    const errors: string[] = [];
    try {
      for (const file of files) {
        try {
          const row = await uploadSingleFile(file, acc);
          acc = [...acc, row];
          await applyChange(acc);
          okCount++;
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (okCount > 0) {
        toast({
          title:
            okCount === 1
              ? "PDF dokument byl nahrán a uložen"
              : `${okCount} PDF dokumentů bylo nahráno a uloženo`,
        });
      }
      if (errors.length) {
        toast({
          variant: "destructive",
          title: "Některá PDF se nepodařilo nahrát",
          description: errors.slice(0, 3).join(" · "),
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (att: ProductCatalogPdfAttachment) => {
    if (!canWrite || customerMode) return;
    if (!window.confirm(`Smazat dokument „${att.displayName || att.fileName}"?`)) return;
    const next = attachments.filter((x) => x.id !== att.id);
    try {
      await applyChange(next, "PDF dokument byl odstraněn");
    } catch {
      return;
    }
    setInstantThumbs((prev) => {
      const copy = { ...prev };
      delete copy[att.id];
      return copy;
    });
    const path = att.storagePath?.trim();
    if (path) {
      try {
        await deleteObject(ref(getFirebaseStorage(), path));
      } catch (e) {
        console.warn("[CatalogPdfAttachments] storage delete", e);
      }
    }
  };

  const showWriteControls = canWrite && !customerMode;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-base font-semibold">{heading}</Label>
        {showWriteControls ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length) void uploadFiles(list);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Nahrávám…" : "Přidat PDF"}
            </Button>
          </>
        ) : null}
      </div>
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Zatím žádné PDF dokumenty.</p>
      ) : (
        <ul className="space-y-3">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start"
            >
              <CatalogPdfThumbnail
                attachment={a}
                instantObjectUrl={instantThumbs[a.id] ?? null}
                onClick={() => openPreview(a)}
              />
              <div className="min-w-0 flex-1 space-y-1">
                {showWriteControls ? (
                  <Input
                    key={`${a.id}-${a.displayName}`}
                    defaultValue={a.displayName}
                    placeholder="Název dokumentu"
                    onBlur={(e) => {
                      const displayName = e.target.value.trim() || a.fileName;
                      const next = attachments.map((x) =>
                        x.id === a.id ? { ...x, displayName } : x
                      );
                      void applyChange(next).catch(() => undefined);
                    }}
                    className="h-8"
                  />
                ) : (
                  <p className="font-medium">{a.displayName || a.fileName}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {a.fileName} · {(a.sizeBytes / 1024).toFixed(0)} KB ·{" "}
                  {new Date(a.uploadedAt).toLocaleDateString("cs-CZ")}
                </p>
                {showWriteControls ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Switch
                      checked={a.customerVisible}
                      onCheckedChange={(v) => {
                        void applyChange(
                          attachments.map((x) =>
                            x.id === a.id ? { ...x, customerVisible: v } : x
                          )
                        );
                      }}
                    />
                    <span className="text-xs">Viditelné pro zákazníka</span>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1 sm:flex-col sm:items-stretch">
                <Button type="button" size="sm" variant="secondary" onClick={() => openPreview(a)}>
                  Zobrazit PDF
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void (async () => {
                      try {
                        const { data } = await loadCatalogPdfBytes(a);
                        const blob = new Blob([data], { type: "application/pdf" });
                        const href = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = href;
                        link.download = a.fileName;
                        link.click();
                        URL.revokeObjectURL(href);
                      } catch (e) {
                        toast({
                          variant: "destructive",
                          title: "Stažení selhalo",
                          description:
                            e instanceof CatalogPdfLoadError
                              ? e.message
                              : e instanceof Error
                                ? e.message
                                : String(e),
                        });
                      }
                    })();
                  }}
                >
                  Stáhnout
                </Button>
                {showWriteControls ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => void removeAttachment(a)}
                  >
                    <Trash2 className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Smazat</span>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {previewAtt ? (
        <CatalogPdfViewerDialog
          open={previewAtt != null}
          onOpenChange={(open) => {
            if (!open) setPreviewAtt(null);
          }}
          title={previewAtt.displayName || previewAtt.fileName}
          attachment={previewAtt}
          fileName={previewAtt.fileName}
        />
      ) : null}
    </div>
  );
}
