"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DocumentPreviewDialog } from "@/components/documents/document-preview-dialog";
import type { ProductCatalogPdfAttachment } from "@/lib/product-catalogs";
import {
  PRODUCT_CATALOG_PDF_MAX_BYTES,
  buildCatalogLevelPdfStoragePath,
  buildProductLevelPdfStoragePath,
  serializePdfAttachmentsForFirestore,
} from "@/lib/product-catalogs";
import { FileText, Trash2 } from "lucide-react";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import { useToast } from "@/hooks/use-toast";

async function isPdfFile(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
}

async function resolveAttachmentUrl(att: ProductCatalogPdfAttachment): Promise<string | null> {
  const cached = typeof att.downloadUrl === "string" ? att.downloadUrl.trim() : "";
  if (cached) return cached;
  const path = typeof att.storagePath === "string" ? att.storagePath.trim() : "";
  if (!path) return null;
  try {
    return await getDownloadURL(ref(getFirebaseStorage(), path));
  } catch {
    return null;
  }
}

export type CatalogPdfAttachmentsSectionProps = {
  companyId: string;
  catalogId: string;
  /** Bez productId = dokumenty katalogu; s productId = dokumenty produktu. */
  productId?: string;
  attachments: ProductCatalogPdfAttachment[];
  canWrite: boolean;
  /** Zákaznický náhled — jen čtení, filtr customerVisible řeší rodič. */
  customerMode?: boolean;
  /** Po nahrání / úpravě / smazání — trvalé uložení do Firestore. */
  onPersist?: (next: ProductCatalogPdfAttachment[]) => Promise<void>;
  /** Lokální stav (dialog produktu před finálním uložením). */
  onChange?: (next: ProductCatalogPdfAttachment[]) => void;
};

export function CatalogPdfAttachmentsSection({
  companyId,
  catalogId,
  productId,
  attachments,
  canWrite,
  customerMode = false,
  onPersist,
  onChange,
}: CatalogPdfAttachmentsSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string; fileName: string } | null>(
    null
  );
  const [urlById, setUrlById] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        attachments.map(async (a) => {
          const url = await resolveAttachmentUrl(a);
          return [a.id, url] as const;
        })
      );
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [id, url] of entries) {
        if (url) next[id] = url;
      }
      setUrlById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [attachments]);

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

  const uploadPdf = async (file: File) => {
    if (!canWrite || customerMode) return;
    if (file.size > PRODUCT_CATALOG_PDF_MAX_BYTES) {
      toast({ variant: "destructive", title: "PDF je větší než 25 MB." });
      return;
    }
    if (!(await isPdfFile(file))) {
      toast({ variant: "destructive", title: "Soubor není platné PDF." });
      return;
    }
    const docId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const storagePath = productId
      ? buildProductLevelPdfStoragePath(companyId, catalogId, productId, docId)
      : buildCatalogLevelPdfStoragePath(companyId, catalogId, docId);
    setUploading(true);
    try {
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
      await applyChange([...attachments, row], "PDF dokument byl nahrán a uložen");
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("uložit"))) {
        toast({
          variant: "destructive",
          title: "Nahrání PDF selhalo",
          description: e instanceof Error ? e.message : String(e),
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
        <Label className="text-base font-semibold">Dokumenty PDF</Label>
        {showWriteControls ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadPdf(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
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
        <ul className="space-y-2">
          {attachments.map((a) => {
            const fileUrl = urlById[a.id] ?? a.downloadUrl ?? "";
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-2 rounded-md border p-2">
                <FileText className="h-5 w-5 shrink-0 text-red-600" aria-hidden />
                <div className="min-w-0 flex-1 space-y-1">
                  {showWriteControls ? (
                    <Input
                      key={`${a.id}-${a.displayName}`}
                      defaultValue={a.displayName}
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
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!fileUrl}
                    onClick={() => {
                      if (!fileUrl) {
                        toast({
                          variant: "destructive",
                          title: "PDF nelze zobrazit",
                          description: "Odkaz na soubor se nepodařilo načíst.",
                        });
                        return;
                      }
                      setPreview({
                        url: fileUrl,
                        title: a.displayName || a.fileName,
                        fileName: a.fileName,
                      });
                    }}
                  >
                    Zobrazit PDF
                  </Button>
                  {fileUrl ? (
                    <Button type="button" size="sm" variant="outline" asChild>
                      <a href={fileUrl} download={a.fileName} target="_blank" rel="noreferrer">
                        Stáhnout
                      </a>
                    </Button>
                  ) : null}
                  {showWriteControls ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void removeAttachment(a)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Smazat</span>
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <DocumentPreviewDialog
        open={preview != null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        title={preview?.title ?? "PDF"}
        fileUrl={preview?.url ?? ""}
        mimeType="application/pdf"
        fileName={preview?.fileName}
      />
    </div>
  );
}
