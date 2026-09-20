"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileArchive, File, ImageIcon, Loader2 } from "lucide-react";
import {
  attachmentKindLabel,
  formatAttachmentSizeBytes,
  isPreviewablePdf,
} from "@/lib/email-mailbox/attachment-meta";
import { cn } from "@/lib/utils";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import { renderPdfPagesToPngBlobs } from "@/lib/pdf-to-image-client";

type Props = {
  attachment: EmailMessageAttachmentMeta;
  canWrite: boolean;
  busy?: boolean;
  onAssign?: () => void;
  onOpen?: () => void;
  onDownload?: () => void;
  /** Načte blob URL PDF pro náhled (autorizovaný fetch). */
  getPdfBlobUrl?: () => Promise<string | null>;
};

export function EmailAttachmentCard(props: Props) {
  const a = props.attachment;
  const isPdf = isPreviewablePdf(a.contentType, a.filename);
  const kind = attachmentKindLabel(a.contentType, a.filename);
  const disabled = !a.storagePath;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState(false);
  const [thumbLoading, setThumbLoading] = useState(false);

  useEffect(() => {
    if (!isPdf || disabled || !props.getPdfBlobUrl) return;
    let cancelled = false;
    let revoked: string | null = null;
    setThumbLoading(true);
    setThumbError(false);

    void (async () => {
      try {
        const pdfUrl = await props.getPdfBlobUrl!();
        if (!pdfUrl || cancelled) return;
        try {
          const blobs = await renderPdfPagesToPngBlobs(pdfUrl, [1], 1.1);
          if (cancelled) return;
        const url = URL.createObjectURL(blobs[0]!);
        revoked = url;
          setThumbUrl(url);
        } finally {
          URL.revokeObjectURL(pdfUrl);
        }
      } catch {
        if (!cancelled) setThumbError(true);
      } finally {
        if (!cancelled) setThumbLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [isPdf, disabled, props.getPdfBlobUrl, a.id]);

  const linkedLabel = a.linkedJobLabel?.trim() || (a.linkedJobId ? a.linkedJobId : null);

  return (
    <div className="rounded-lg border p-3 space-y-2 bg-card">
      <button
        type="button"
        className={cn("w-full text-left", disabled && "opacity-60 cursor-not-allowed")}
        disabled={disabled}
        onClick={() => props.onOpen?.()}
      >
        <div className="relative h-28 w-full rounded-md border overflow-hidden bg-muted/30 flex items-center justify-center">
          {isPdf && thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl} alt="" className="h-full w-full object-cover object-top" />
          ) : isPdf && thumbLoading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : isPdf && thumbError ? (
            <p className="text-[10px] text-center text-muted-foreground px-2">Nelze vytvořit náhled</p>
          ) : kind === "Obrázek" ? (
            <ImageIcon className="h-10 w-10 text-sky-600" />
          ) : kind === "Excel" ? (
            <FileSpreadsheet className="h-10 w-10 text-emerald-600" />
          ) : kind === "ZIP" ? (
            <FileArchive className="h-10 w-10 text-amber-700" />
          ) : (
            <File className="h-10 w-10 text-muted-foreground" />
          )}
        </div>
        <p className="mt-2 text-sm font-medium truncate">{a.filename}</p>
        <p className="text-xs text-muted-foreground">
          {kind} · {formatAttachmentSizeBytes(a.size)}
        </p>
        {a.aiSummary ? (
          <p className="text-xs text-primary/90 mt-1 line-clamp-3">{a.aiSummary}</p>
        ) : null}
        {linkedLabel ? (
          <p className="text-xs font-medium text-emerald-700 mt-1">
            Přiřazeno: {linkedLabel}
          </p>
        ) : null}
      </button>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => props.onOpen?.()}>
          Otevřít
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => props.onDownload?.()}>
          Stáhnout
        </Button>
        {props.canWrite && props.onAssign ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={props.busy || disabled}
            onClick={(e) => {
              e.stopPropagation();
              props.onAssign?.();
            }}
          >
            {linkedLabel ? "Změnit zakázku" : "Přiřadit k zakázce"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
