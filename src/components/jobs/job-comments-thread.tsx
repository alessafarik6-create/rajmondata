"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ExpandableNoteText } from "@/components/jobs/job-note-text-block";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { safeTime } from "@/lib/date-safe";
import {
  buildMessageAuthorPersistFields,
  buildMessageTimestampClientFields,
  compareMessagesByCreatedAt,
  formatMessageDateFromValue,
} from "@/lib/format-message-date";
import { JobMessageHeader } from "@/components/jobs/job-message-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JD } from "@/lib/job-detail-page-styles";

export type JobCommentsTarget =
  | { targetType: "job" }
  | {
      targetType: "file";
      fileId: string;
      folderId?: string | null;
      fileName?: string | null;
    };

type CommentRow = Record<string, unknown> & { id: string };

function commentReadByUser(comment: CommentRow, userId: string): boolean {
  const readAtBy = comment.readAtBy as Record<string, unknown> | undefined;
  if (readAtBy && readAtBy[userId] != null) return true;
  const readBy = comment.readBy as string[] | undefined;
  return Array.isArray(readBy) && readBy.includes(userId);
}

function earliestOtherReaderMs(comment: CommentRow, authorId: string): number {
  const readAtBy = comment.readAtBy as Record<string, unknown> | undefined;
  if (!readAtBy) return 0;
  let best = 0;
  for (const [uid, v] of Object.entries(readAtBy)) {
    if (uid === authorId) continue;
    const ms = safeTime(v);
    if (!ms) continue;
    if (best === 0 || ms < best) best = ms;
  }
  return best;
}

function legacyOtherHasRead(comment: CommentRow, authorId: string): boolean {
  const readBy = comment.readBy as string[] | undefined;
  if (!Array.isArray(readBy)) return false;
  return readBy.some((id) => id && id !== authorId);
}

export function computeUnreadCountForTarget(params: {
  comments: CommentRow[];
  userId: string | null | undefined;
}): number {
  const uid = params.userId || "";
  if (!uid) return 0;
  let n = 0;
  for (const c of params.comments) {
    if (commentReadByUser(c, uid)) continue;
    n += 1;
  }
  return n;
}

export function JobCommentsThread(props: {
  firestore: unknown;
  companyId: string;
  jobId: string;
  /** Pro zápis a readBy */
  userId: string;
  authorName: string;
  authorRole: "admin" | "employee";
  canPost: boolean;
  title: string;
  /** Interní vlákno — zákazník ho nevidí (výchozí internal). */
  chatChannel?: "internal";
  channelBadgeLabel?: string;
  target: JobCommentsTarget;
  /** pro embed vs dialog */
  dense?: boolean;
  /** Plná šířka detailu zakázky — bez úzkého scroll panelu */
  wide?: boolean;
  /** Souhrn na dashboardu — plný chat v dialogu */
  presentation?: "full" | "summary";
  className?: string;
  messagesMaxHeightClass?: string;
  /** zavolat po odeslání (např. notifikace) */
  onAfterSend?: (comment: {
    id: string;
    targetType: "job" | "file";
    fileId?: string | null;
    folderId?: string | null;
    fileName?: string | null;
    message: string;
  }) => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const isSummary = props.presentation === "summary";

  const firestore = props.firestore as any;

  const commentsQuery = useMemoFirebase(() => {
    if (!firestore || !props.companyId || !props.jobId) return null;
    const base = collection(
      firestore,
      "companies",
      props.companyId,
      "jobs",
      props.jobId,
      "comments"
    );
    if (props.target.targetType === "job") {
      return query(
        base,
        where("targetType", "==", "job"),
        limit(200)
      );
    }
    const folderId = props.target.folderId ?? null;
    return query(
      base,
      where("fileId", "==", props.target.fileId),
      limit(200)
    );
  }, [
    firestore,
    props.companyId,
    props.jobId,
    props.target.targetType,
    props.target.targetType === "file" ? props.target.fileId : "",
    props.target.targetType === "file" ? String(props.target.folderId ?? "") : "",
  ]);

  const {
    data: commentsRaw = [],
    isLoading,
    error,
  } = useCollection(commentsQuery);

  const comments = useMemo(() => {
    const listAll = (Array.isArray(commentsRaw) ? commentsRaw : []) as CommentRow[];
    const list = listAll.filter((c) => c && typeof c.id === "string");

    // Avoid composite index requirements:
    // - job: query is targetType=job (no orderBy), sort in JS
    // - file: query is fileId only (no orderBy), filter+sort in JS
    if (props.target.targetType === "job") {
      return list
        .filter((c) => String(c.targetType ?? "") === "job")
        .filter((c) => {
          const ch = String(c.chatChannel ?? "internal").trim();
          return ch !== "customer";
        })
        .slice()
        .sort(compareMessagesByCreatedAt);
    }
    const fileId = props.target.fileId;
    const folderId = props.target.folderId ?? null;
    return list
      .filter((c) => String(c.targetType ?? "") === "file")
      .filter((c) => String(c.fileId ?? "") === fileId)
      .filter((c) => (c.folderId ?? null) === folderId)
      .slice()
      .sort(compareMessagesByCreatedAt);
  }, [commentsRaw, props.target]);

  const unreadCount = useMemo(
    () => computeUnreadCountForTarget({ comments, userId: props.userId }),
    [comments, props.userId]
  );

  // Mark as read when opened / new messages arrive.
  useEffect(() => {
    if (!firestore || !props.userId) return;
    const unread = comments.filter((c) => !commentReadByUser(c, props.userId));
    if (!unread.length) return;
    const batch = writeBatch(firestore);
    for (const c of unread) {
      batch.update(
        doc(
          firestore,
          "companies",
          props.companyId,
          "jobs",
          props.jobId,
          "comments",
          c.id
        ),
        {
          readBy: arrayUnion(props.userId),
          [`readAtBy.${props.userId}`]: serverTimestamp(),
        }
      );
    }
    void batch.commit().catch(() => {});
  }, [firestore, props.companyId, props.jobId, props.userId, comments]);

  const send = useCallback(async () => {
    if (!firestore || !props.canPost) return;
    const message = draft.trim();
    if (!message) return;
    setSending(true);
    try {
      const base = collection(
        firestore,
        "companies",
        props.companyId,
        "jobs",
        props.jobId,
        "comments"
      );
      const payload: Record<string, unknown> = {
        organizationId: props.companyId,
        jobId: props.jobId,
        chatChannel: props.chatChannel ?? "internal",
        targetType: props.target.targetType,
        fileId: props.target.targetType === "file" ? props.target.fileId : null,
        folderId:
          props.target.targetType === "file" ? props.target.folderId ?? null : null,
        fileName:
          props.target.targetType === "file" ? props.target.fileName ?? null : null,
        message,
        ...buildMessageAuthorPersistFields({
          userId: props.userId,
          authorName: props.authorName,
          authorRole: props.authorRole,
        }),
        createdAt: serverTimestamp(),
        timestamp: serverTimestamp(),
        sentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...buildMessageTimestampClientFields(),
        readBy: [props.userId],
        readAtBy: { [props.userId]: serverTimestamp() },
      };
      const ref = await addDoc(base, payload);
      setDraft("");
      await props.onAfterSend?.({
        id: ref.id,
        targetType: props.target.targetType,
        fileId: (payload.fileId as string | null | undefined) ?? null,
        folderId: (payload.folderId as string | null | undefined) ?? null,
        fileName: (payload.fileName as string | null | undefined) ?? null,
        message,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nelze odeslat zprávu",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSending(false);
    }
  }, [
    firestore,
    props.canPost,
    draft,
    props.companyId,
    props.jobId,
    props.target,
    props.userId,
    props.authorName,
    props.authorRole,
    props.onAfterSend,
    toast,
  ]);

  const containerHeightClassName = props.wide
    ? ""
    : props.dense
      ? "h-[56vh] max-h-[56vh]"
      : "h-[62vh] max-h-[62vh]";

  const messagesScrollClassName = props.messagesMaxHeightClass
    ? cn("space-y-3 min-h-[160px] overflow-y-auto pr-1", props.messagesMaxHeightClass)
    : props.wide
      ? "space-y-3 min-h-[200px] max-h-[min(70vh,720px)] overflow-y-auto pr-1"
      : "flex-1 space-y-2 overflow-y-auto pr-1";

  const lastMessage = comments.length > 0 ? comments[comments.length - 1] : null;
  const lastPreview = lastMessage ? String(lastMessage.message ?? "").trim() : "";

  if (isSummary) {
    return (
      <>
        <div className={cn(JD.dashCard, props.className)}>
          <p className={JD.dashCardTitle}>{props.title}</p>
          <p className={cn(JD.dashCardMuted, "mt-1")}>
            {comments.length} zpráv
            {unreadCount > 0 ? (
              <span className="text-destructive font-semibold"> · {unreadCount} nepřečteno</span>
            ) : null}
          </p>
          {lastPreview ? (
            <p className="mt-2 line-clamp-2 text-[13px] text-gray-800">
              <span className="text-gray-500">Poslední: </span>
              &quot;{lastPreview}&quot;
            </p>
          ) : (
            <p className="mt-2 text-[13px] text-gray-600">Zatím žádné zprávy.</p>
          )}
          <button
            type="button"
            className="mt-2.5 text-xs font-semibold text-primary hover:underline"
            onClick={() => setSummaryDialogOpen(true)}
          >
            Otevřít chat
          </button>
        </div>
        <Dialog open={summaryDialogOpen} onOpenChange={setSummaryDialogOpen}>
          <DialogContent className="max-h-[92vh] w-[95vw] max-w-3xl overflow-hidden flex flex-col p-0 gap-0">
            <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
              <DialogTitle>{props.title}</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              <JobCommentsThread
                {...props}
                presentation="full"
                className="border-0 shadow-none"
                wide
                messagesMaxHeightClass="max-h-[min(60vh,520px)]"
              />
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Card className={cn("border border-border bg-background text-foreground shadow-sm", props.className)}>
      <CardHeader className={cn(props.dense ? "pb-2" : "")}>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
          <span className="flex flex-wrap items-center gap-2">
            {props.title}
            {props.channelBadgeLabel ? (
              <Badge variant="secondary" className="text-[10px] font-normal">
                {props.channelBadgeLabel}
              </Badge>
            ) : null}
          </span>
          {unreadCount > 0 ? (
            <Badge variant="destructive" className="text-[10px]">
              {unreadCount} nepřečteno
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              {comments.length} zpráv
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          "flex flex-col gap-3",
          containerHeightClassName,
          props.wide && "min-w-0",
          props.dense ? "pt-0" : ""
        )}
      >
        <div className={messagesScrollClassName}>
          {error ? (
            <>
              {console.error("[JobCommentsThread] load failed", error)}
              <p className="text-sm text-destructive">
                Poznámky se nepodařilo načíst.
              </p>
            </>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground">Načítám…</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné zprávy.</p>
          ) : (
            comments.map((c) => {
              const authorId = String(c.createdBy ?? c.authorId ?? "");
              const mine = authorId === props.userId;
              const msg = String(c.message ?? "");
              const myReadMs = mine
                ? 0
                : safeTime((c.readAtBy as Record<string, unknown> | undefined)?.[props.userId]);
              const otherReadMs = mine ? earliestOtherReaderMs(c, authorId) : 0;
              const readLine = mine
                ? otherReadMs > 0
                  ? `přečteno ${formatMessageDateFromValue(otherReadMs)}`
                  : legacyOtherHasRead(c, authorId)
                    ? "přečteno"
                    : "nepřečteno"
                : myReadMs > 0
                  ? `přečteno ${formatMessageDateFromValue(myReadMs)}`
                  : commentReadByUser(c, props.userId)
                    ? "přečteno"
                    : "nepřečteno";
              return (
                <div
                  key={c.id}
                  className={cn(
                    "flex w-full",
                    mine ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[92%] min-w-0 rounded-2xl border bg-white px-3 py-2.5 shadow-sm break-words",
                      props.wide ? "sm:max-w-[75%]" : "sm:max-w-[75%]",
                      mine
                        ? "border-orange-300 rounded-br-md"
                        : "border-sky-200 rounded-bl-md",
                    )}
                  >
                    <JobMessageHeader message={c} />
                    <ExpandableNoteText text={msg} />
                    <div className="mt-1.5 text-xs text-gray-600">{readLine}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {props.canPost ? (
          <div className="flex flex-col gap-2 border-t border-border bg-background/95 pt-3 sm:flex-row sm:items-stretch">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Napište zprávu…"
              className="min-h-[44px] min-w-0 flex-1 bg-background text-foreground placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button
              type="button"
              className="min-h-[44px] shrink-0"
              disabled={sending || !draft.trim()}
              onClick={() => void send()}
            >
              Odeslat
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nemáte oprávnění odesílat zprávy k této zakázce.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

