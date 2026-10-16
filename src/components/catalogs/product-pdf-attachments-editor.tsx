"use client";

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ProductCatalogPdfAttachment } from "@/lib/product-catalogs";
import { PRODUCT_CATALOG_PDF_MAX_BYTES } from "@/lib/product-catalogs";
import { FileText, ExternalLink, Trash2 } from "lucide-react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";

async function isPdfFile(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
}

type Props = {
  companyId: string;
  catalogId: string;
  productId: string;
  attachments: ProductCatalogPdfAttachment[];
  onChange: (next: ProductCatalogPdfAttachment[]) => void;
  canWrite: boolean;
};

export function ProductPdfAttachmentsEditor({
  companyId,
  catalogId,
  productId,
  attachments,
  onChange,
  canWrite,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const uploadPdf = async (file: File) => {
    if (!canWrite) return;
    if (file.size > PRODUCT_CATALOG_PDF_MAX_BYTES) {
      throw new Error("PDF je větší než 25 MB.");
    }
    if (!(await isPdfFile(file))) {
      throw new Error("Soubor není platné PDF.");
    }
    const docId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const storagePath = `companies/${companyId}/catalogs/${catalogId}/products/${productId}/documents/${docId}.pdf`;
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
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        customerVisible: false,
      };
      onChange([...attachments, row]);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-base font-semibold">Přílohy a dokumenty</Label>
        {canWrite ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadPdf(f).catch(console.error);
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
              Přidat PDF dokument
            </Button>
          </>
        ) : null}
      </div>
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Zatím žádné PDF přílohy.</p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-2 rounded-md border p-2">
              <FileText className="h-5 w-5 shrink-0 text-red-600" />
              <div className="min-w-0 flex-1 space-y-1">
                {canWrite ? (
                  <Input
                    value={a.displayName}
                    onChange={(e) =>
                      onChange(
                        attachments.map((x) =>
                          x.id === a.id ? { ...x, displayName: e.target.value } : x
                        )
                      )
                    }
                    className="h-8"
                  />
                ) : (
                  <p className="font-medium">{a.displayName}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {a.fileName} · {(a.sizeBytes / 1024).toFixed(0)} KB ·{" "}
                  {new Date(a.uploadedAt).toLocaleDateString("cs-CZ")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    checked={a.customerVisible}
                    disabled={!canWrite}
                    onCheckedChange={(v) =>
                      onChange(
                        attachments.map((x) =>
                          x.id === a.id ? { ...x, customerVisible: v } : x
                        )
                      )
                    }
                  />
                  <span className="text-xs">Viditelné pro zákazníka</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setPreviewUrl(a.downloadUrl ?? null)}
                >
                  Otevřít
                </Button>
                {a.downloadUrl ? (
                  <Button type="button" size="sm" variant="outline" asChild>
                    <a href={a.downloadUrl} download={a.fileName} target="_blank" rel="noreferrer">
                      Stáhnout
                    </a>
                  </Button>
                ) : null}
                {a.downloadUrl ? (
                  <Button type="button" size="sm" variant="ghost" asChild>
                    <a href={a.downloadUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                ) : null}
                {canWrite ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => onChange(attachments.filter((x) => x.id !== a.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {previewUrl ? (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={() => setPreviewUrl(null)}>
              Zavřít náhled
            </Button>
          </div>
          <iframe title="PDF náhled" src={previewUrl} className="h-[420px] w-full rounded border" />
        </div>
      ) : null}
    </div>
  );
}
