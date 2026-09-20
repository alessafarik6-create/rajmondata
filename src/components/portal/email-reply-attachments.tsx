"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAttachmentSizeBytes, userVisibleAttachments } from "@/lib/email-mailbox/attachment-meta";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import type { JobDocumentEmailAttachmentRef } from "@/lib/job-document-email-attachments";
import { Paperclip, FolderOpen, X } from "lucide-react";

export type LocalReplyFile = { id: string; file: File };

type RajmondataPick = JobDocumentEmailAttachmentRef & { jobId: string };

type Props = {
  companyId: string;
  jobId?: string | null;
  sourceAttachments?: EmailMessageAttachmentMeta[] | null;
  forwardMode?: boolean;
  getToken: () => Promise<string>;
  localFiles: LocalReplyFile[];
  onLocalFilesChange: (files: LocalReplyFile[]) => void;
  forwardAttachmentIds: string[];
  onForwardAttachmentIdsChange: (ids: string[]) => void;
  rajmondataRefs: RajmondataPick[];
  onRajmondataRefsChange: (refs: RajmondataPick[]) => void;
};

export function EmailReplyAttachments(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rajOpen, setRajOpen] = useState(false);
  const [rajJobId, setRajJobId] = useState(props.jobId ?? "");
  const [rajOptions, setRajOptions] = useState<
    { id: string; kind: "company_document"; sourceId: string; filename: string; sourceLabel: "Dokument zakázky" }[]
  >([]);

  const visibleSource = userVisibleAttachments(props.sourceAttachments);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = [...e.dataTransfer.files];
      if (!files.length) return;
      props.onLocalFilesChange([
        ...props.localFiles,
        ...files.map((file) => ({ id: crypto.randomUUID(), file })),
      ]);
    },
    [props]
  );

  async function loadRajmondata() {
    const jid = rajJobId.trim();
    if (!jid) return;
    const token = await props.getToken();
    const res = await fetch(
      `/api/company/email-mailbox/rajmondata-attachments?companyId=${encodeURIComponent(props.companyId)}&jobId=${encodeURIComponent(jid)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.ok) setRajOptions(data.attachments ?? []);
  }

  return (
    <div className="space-y-2 border-t pt-3">
      {props.forwardMode && visibleSource.length ? (
        <div className="rounded-md border p-2 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Původní přílohy</p>
          {visibleSource.map((att) => {
            const checked = props.forwardAttachmentIds.includes(att.id);
            return (
              <label key={att.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    const on = Boolean(v);
                    props.onForwardAttachmentIdsChange(
                      on
                        ? [...props.forwardAttachmentIds, att.id]
                        : props.forwardAttachmentIds.filter((id) => id !== att.id)
                    );
                  }}
                />
                <span className="truncate">
                  {att.filename} · {formatAttachmentSizeBytes(att.size)}
                </span>
              </label>
            );
          })}
        </div>
      ) : null}

      {props.localFiles.map((row) => (
        <div key={row.id} className="flex items-center gap-2 text-sm">
          <Paperclip className="h-4 w-4 shrink-0" />
          <span className="truncate flex-1">
            {row.file.name} · {formatAttachmentSizeBytes(row.file.size)}
          </span>
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={() =>
              props.onLocalFilesChange(props.localFiles.filter((f) => f.id !== row.id))
            }
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      {props.rajmondataRefs.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-sm text-primary">
          <FolderOpen className="h-4 w-4" />
          <span className="truncate flex-1">
            RAJMONDATA: {r.filename}
          </span>
          <button
            type="button"
            onClick={() =>
              props.onRajmondataRefsChange(props.rajmondataRefs.filter((x) => x.id !== r.id))
            }
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      <div
        className="flex flex-wrap gap-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            props.onLocalFilesChange([
              ...props.localFiles,
              ...files.map((file) => ({ id: crypto.randomUUID(), file })),
            ]);
            e.target.value = "";
          }}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
          <Paperclip className="h-4 w-4 mr-1" /> Přiložit soubor
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setRajOpen(true)}>
          <FolderOpen className="h-4 w-4 mr-1" /> Přiložit z RAJMONDATA
        </Button>
      </div>

      <Dialog open={rajOpen} onOpenChange={setRajOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Přiložit z RAJMONDATA</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="ID zakázky"
              value={rajJobId}
              onChange={(e) => setRajJobId(e.target.value)}
            />
            <Button size="sm" variant="secondary" onClick={() => void loadRajmondata()}>
              Načíst dokumenty
            </Button>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {rajOptions.map((o) => (
                <Button
                  key={o.id}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    props.onRajmondataRefsChange([
                      ...props.rajmondataRefs,
                      {
                        id: o.id,
                        kind: o.kind,
                        sourceId: o.sourceId,
                        filename: o.filename,
                        sourceLabel: o.sourceLabel,
                        jobId: rajJobId,
                      },
                    ]);
                    setRajOpen(false);
                  }}
                >
                  {o.filename}
                </Button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
