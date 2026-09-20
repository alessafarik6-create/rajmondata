"use client";

import { Button } from "@/components/ui/button";
import { FileText, FileSpreadsheet, FileArchive, File, ImageIcon } from "lucide-react";
import {
  attachmentKindLabel,
  formatAttachmentSizeBytes,
  isPreviewablePdf,
} from "@/lib/email-mailbox/attachment-meta";
import { cn } from "@/lib/utils";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";

type Props = {
  attachment: EmailMessageAttachmentMeta;
  canWrite: boolean;
  busy?: boolean;
  onAssign?: () => void;
  onOpen?: () => void;
  onDownload?: () => void;
};

function FileIcon({ filename, contentType }: { filename: string; contentType: string }) {
  const kind = attachmentKindLabel(contentType, filename);
  if (kind === "PDF") return <FileText className="h-10 w-10 text-red-600" />;
  if (kind === "Excel") return <FileSpreadsheet className="h-10 w-10 text-emerald-600" />;
  if (kind === "ZIP") return <FileArchive className="h-10 w-10 text-amber-700" />;
  if (kind === "Obrázek") return <ImageIcon className="h-10 w-10 text-sky-600" />;
  return <File className="h-10 w-10 text-muted-foreground" />;
}

export function EmailAttachmentCard(props: Props) {
  const a = props.attachment;
  const isPdf = isPreviewablePdf(a.contentType, a.filename);
  const kind = attachmentKindLabel(a.contentType, a.filename);
  const disabled = !a.storagePath;

  return (
    <div className="rounded-lg border p-3 space-y-2 bg-card">
      <button
        type="button"
        className={cn("w-full text-left", disabled && "opacity-60 cursor-not-allowed")}
        disabled={disabled}
        onClick={() => props.onOpen?.()}
      >
        <div className="relative h-28 w-full rounded-md border overflow-hidden bg-muted/30 flex items-center justify-center">
          <FileIcon filename={a.filename} contentType={a.contentType} />
          {isPdf ? (
            <span className="absolute bottom-1 text-[10px] text-muted-foreground px-1">
              PDF · náhled po kliknutí
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm font-medium truncate">{a.filename}</p>
        <p className="text-xs text-muted-foreground">
          {kind} · {formatAttachmentSizeBytes(a.size)}
        </p>
        {a.aiSummary ? (
          <p className="text-xs text-primary/90 mt-1 line-clamp-3">{a.aiSummary}</p>
        ) : null}
        {a.linkedJobId ? (
          <p className="text-xs text-emerald-700 mt-1">Přiřazeno k zakázce</p>
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
          <Button size="sm" variant="secondary" disabled={props.busy || disabled} onClick={props.onAssign}>
            Přiřadit k zakázce
          </Button>
        ) : null}
      </div>
    </div>
  );
}
