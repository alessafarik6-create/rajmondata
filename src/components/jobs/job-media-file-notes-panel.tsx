"use client";

import React, { useCallback, useMemo, useState } from "react";
import { addDoc, collection, serverTimestamp, type Firestore } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ExpandableNoteText } from "@/components/jobs/job-note-text-block";
import { JobMessageHeader } from "@/components/jobs/job-message-header";
import { cn } from "@/lib/utils";
import {
  buildCustomerMediaNotePayload,
  buildStaffMediaNotePayload,
  filterMediaNotesForCustomerView,
  mergeFileMediaNotesWithLegacyApprovalComment,
  pickMediaNotesForFile,
  type JobMediaFileNoteDoc,
  type JobMediaFileNoteTarget,
} from "@/lib/job-media-file-notes";

type Props = {
  firestore: unknown;
  companyId: string;
  jobId: string;
  userId: string;
  authorName: string;
  target: JobMediaFileNoteTarget;
  allNotes: JobMediaFileNoteDoc[];
  /** Zákaznický portál — skrýt interní, jen přidávání zákaznických poznámek. */
  customerPortal?: boolean;
  readOnly?: boolean;
  dense?: boolean;
  className?: string;
  /** Volitelný řádek souboru — doplní customerComment ze schválení do historie. */
  legacyFileRow?: Record<string, unknown> | null;
  onNoteAdded?: (note: JobMediaFileNoteDoc) => void;
};

export function JobMediaFileNotesPanel(props: Props) {
  const {
    firestore,
    companyId,
    jobId,
    userId,
    authorName,
    target,
    allNotes,
    customerPortal = false,
    readOnly = false,
    dense = false,
    className,
    legacyFileRow,
    onNoteAdded,
  } = props;
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const fileNotes = useMemo(() => {
    let picked = pickMediaNotesForFile(allNotes, target);
    if (legacyFileRow) {
      picked = mergeFileMediaNotesWithLegacyApprovalComment(picked, legacyFileRow, target);
    }
    if (!customerPortal) return picked;
    return filterMediaNotesForCustomerView(picked, userId);
  }, [allNotes, target, legacyFileRow, customerPortal, userId]);

  const canPost = !readOnly && Boolean(userId) && Boolean(firestore);

  const send = useCallback(async () => {
    const fs = firestore as Firestore | null;
    if (!fs || !canPost) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const base = customerPortal
        ? buildCustomerMediaNotePayload({
            companyId,
            jobId,
            target,
            text,
            authorId: userId,
            authorName,
          })
        : buildStaffMediaNotePayload({
            companyId,
            jobId,
            target,
            text,
            authorId: userId,
            authorName,
            authorType: "admin",
            visibleToCustomer: true,
          });
      const ref = await addDoc(
        collection(fs, "companies", companyId, "jobs", jobId, "media_notes"),
        {
          ...base,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
      const optimistic: JobMediaFileNoteDoc = {
        ...base,
        id: ref.id,
        createdAt: Date.now(),
        visibleToCustomer: base.visibleToCustomer,
      };
      setDraft("");
      onNoteAdded?.(optimistic);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Poznámku se nepodařilo uložit",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSending(false);
    }
  }, [
    firestore,
    canPost,
    draft,
    customerPortal,
    companyId,
    jobId,
    target,
    userId,
    authorName,
    onNoteAdded,
    toast,
  ]);

  return (
    <div className={cn("space-y-2", className)}>
      <p className={cn("font-medium text-gray-800", dense ? "text-xs" : "text-sm")}>
        Poznámky k výkresu
      </p>
      {fileNotes.length === 0 ? (
        <p className={cn("text-muted-foreground", dense ? "text-xs" : "text-sm")}>
          Zatím žádné poznámky.
        </p>
      ) : (
        <ul className="space-y-2 max-h-48 overflow-y-auto overscroll-contain pr-1">
          {fileNotes.map((n) => {
            const noteRecord = {
              authorName: n.authorName,
              createdByName: n.authorName,
              authorRole: n.authorType,
              createdByRole: n.authorType,
              createdAt: n.createdAt,
              updatedAt: n.updatedAt,
            } as Record<string, unknown>;
            const shell =
              n.authorType === "customer"
                ? "border-amber-100 border-l-amber-500 bg-amber-50/40"
                : n.visibleToCustomer
                  ? "border-l-orange-500 bg-white"
                  : "border-l-slate-400 bg-slate-50/80";
            return (
              <li
                key={n.id}
                className={cn(
                  "rounded-md border border-border/50 border-l-[3px] px-2 py-2",
                  shell
                )}
              >
                <JobMessageHeader message={noteRecord} className="mb-1 space-y-0.5" />
                <ExpandableNoteText text={n.text} dense={dense} />
              </li>
            );
          })}
        </ul>
      )}
      {canPost ? (
        <div className="space-y-2 border-t border-border/50 pt-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              customerPortal
                ? "Vaše poznámka k tomuto výkresu…"
                : "Poznámka viditelná zákazníkovi…"
            }
            rows={dense ? 2 : 3}
            className={cn("resize-y", dense ? "text-sm min-h-[4rem]" : "min-h-[5rem]")}
          />
          <Button
            type="button"
            size="sm"
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Uložit poznámku
          </Button>
        </div>
      ) : null}
    </div>
  );
}
