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
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatDateSafe, safeTime } from "@/lib/date-safe";

export type JobCommentsTarget =
  | { targetType: "job" }
  | {
      targetType: "file";
      fileId: string;
      folderId?: string | null;
      fileName?: string | null;
    };

type CommentRow = Record<string, unknown> & { id: string };

const millisFromTimestampLike = safeTime;

export function computeUnreadCountForTarget(params: {
  comments: CommentRow[];
  userId: string | null | undefined;
}): number {
  const uid = params.userId || "";
  if (!uid) return 0;
  let n = 0;
  for (const c of params.comments) {
    const readBy = (c.readBy as unknown) as string[] | undefined;
    if (Array.isArray(readBy) && readBy.includes(uid)) continue;
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
  target: JobCommentsTarget;
  /** pro embed vs dialog */
  dense?: boolean;
  className?: string;
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
        .slice()
        .sort((a, b) => millisFromTimestampLike(a.createdAt) - millisFromTimestampLike(b.createdAt));
    }
    const fileId = props.target.fileId;
    const folderId = props.target.folderId ?? null;
    return list
      .filter((c) => String(c.targetType ?? "") === "file")
      .filter((c) => String(c.fileId ?? "") === fileId)
      .filter((c) => (c.folderId ?? null) === folderId)
      .slice()
      .sort((a, b) => millisFromTimestampLike(a.createdAt) - millisFromTimestampLike(b.createdAt));
  }, [commentsRaw, props.target]);

  const unreadCount = useMemo(
    () => computeUnreadCountForTarget({ comments, userId: props.userId }),
    [comments, props.userId]
  );

  // Mark as read when opened / new messages arrive.
  useEffect(() => {
    if (!firestore || !props.userId) return;
    const unread = comments.filter((c) => {
      const rb = (c.readBy as unknown) as string[] | undefined;
      return !Array.isArray(rb) || !rb.includes(props.userId);
    });
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
        { readBy: arrayUnion(props.userId) }
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
        targetType: props.target.targetType,
        fileId: props.target.targetType === "file" ? props.target.fileId : null,
        folderId:
          props.target.targetType === "file" ? props.target.folderId ?? null : null,
        fileName:
          props.target.targetType === "file" ? props.target.fileName ?? null : null,
        message,
        authorId: props.userId,
        authorName: props.authorName,
        authorRole: props.authorRole,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        readBy: [props.userId],
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

  const containerHeightClassName = props.dense
    ? "h-[56vh] max-h-[56vh]"
    : "h-[62vh] max-h-[62vh]";

  return (
    <Card className={cn("border border-border bg-background text-foreground shadow-sm", props.className)}>
      <CardHeader className={cn(props.dense ? "pb-2" : "")}>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>{props.title}</span>
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
      <CardContent className={cn("flex flex-col gap-3", containerHeightClassName, props.dense ? "pt-0" : "")}>
        <div className={cn("flex-1 space-y-2 overflow-y-auto pr-1")}>
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
              const mine = String(c.authorId ?? "") === props.userId;
              const role = String(c.authorRole ?? "");
              const author = String(c.authorName ?? "—");
              const msg = String(c.message ?? "");
              const dt = formatDateSafe(c.createdAt);
              const readBy = (c.readBy as unknown) as string[] | undefined;
              const read = Array.isArray(readBy) && readBy.includes(props.userId);
              const isAdmin = role === "admin";
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
                      "max-w-[92%] rounded-2xl border px-3 py-2 text-sm sm:max-w-[75%]",
                      isAdmin
                        ? "border-orange-200 bg-orange-50 text-orange-950 dark:border-orange-800/60 dark:bg-orange-950/30 dark:text-orange-50"
                        : "border-slate-200 bg-slate-50 text-slate-950 dark:border-slate-700/60 dark:bg-slate-900/50 dark:text-slate-50",
                      mine ? "rounded-br-md" : "rounded-bl-md"
                    )}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground dark:text-muted-foreground">
                      <span className="font-medium text-foreground/90">{author}</span>
                      <Badge
                        className={cn(
                          "h-5 px-2 text-[10px] font-semibold",
                          isAdmin
                            ? "bg-orange-600 text-white hover:bg-orange-600"
                            : "bg-sky-600 text-white hover:bg-sky-600"
                        )}
                      >
                        {isAdmin ? "admin" : "zaměstnanec"}
                      </Badge>
                      <span className="text-foreground/70">{dt}</span>
                      <span className="ml-auto text-foreground/70">
                        {read ? "přečteno" : "nepřečteno"}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap break-words text-foreground">{msg}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {props.canPost ? (
          <div className="sticky bottom-0 flex gap-2 border-t border-border bg-background/95 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Napište zprávu…"
              className="min-h-[44px] bg-background text-foreground placeholder:text-muted-foreground"
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

