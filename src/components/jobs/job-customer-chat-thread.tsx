"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { useCollection, useDoc, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ExpandableNoteText } from "@/components/jobs/job-note-text-block";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatCsDateTimeDot, safeTime } from "@/lib/date-safe";
import {
  authorRoleLabelCs,
  customerChatMessageMatchesJob,
  customerConversationId,
  resolveCustomerPortalUidFromJob,
} from "@/lib/job-customer-chat";
import { notifyJobActivity } from "@/lib/job-activity-notify-client";

type MessageRow = Record<string, unknown> & { id: string };

type Props = {
  firestore: unknown;
  companyId: string;
  jobId: string;
  job: Record<string, unknown>;
  user: User;
  authorName: string;
  className?: string;
};

export function JobCustomerChatThread({
  firestore,
  companyId,
  jobId,
  job,
  user,
  authorName,
  className,
}: Props) {
  const { toast } = useToast();
  const fs = firestore as ReturnType<typeof import("firebase/firestore").getFirestore> | null;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const customerUid = useMemo(() => resolveCustomerPortalUidFromJob(job), [job]);
  const conversationId = customerUid ? customerConversationId(customerUid) : null;

  const conversationRef = useMemoFirebase(
    () =>
      fs && conversationId
        ? doc(fs, "companies", companyId, "customer_conversations", conversationId)
        : null,
    [fs, companyId, conversationId]
  );
  const { data: conversation } = useDoc(conversationRef);

  const messagesQuery = useMemoFirebase(
    () =>
      fs && conversationId
        ? query(
            collection(
              fs,
              "companies",
              companyId,
              "customer_conversations",
              conversationId,
              "messages"
            ),
            orderBy("createdAt", "asc"),
            limit(400)
          )
        : null,
    [fs, companyId, conversationId]
  );
  const { data: messagesRaw = [], isLoading } = useCollection(messagesQuery);

  const messages = useMemo(() => {
    const list = (Array.isArray(messagesRaw) ? messagesRaw : []) as MessageRow[];
    return list
      .filter((m) => customerChatMessageMatchesJob(m, jobId, { includeLegacyWithoutJobId: true }))
      .slice()
      .sort((a, b) => safeTime(a.createdAt) - safeTime(b.createdAt));
  }, [messagesRaw, jobId]);

  useEffect(() => {
    if (!fs || !conversationId || !user.uid) return;
    const unreadFromCustomer = messages.filter(
      (m) =>
        String(m.senderRole ?? "") === "customer" &&
        m.isRead !== true &&
        String(m.senderId ?? "") !== user.uid
    );
    if (!unreadFromCustomer.length) return;
    const batch = writeBatch(fs);
    for (const m of unreadFromCustomer) {
      batch.update(
        doc(
          fs,
          "companies",
          companyId,
          "customer_conversations",
          conversationId,
          "messages",
          m.id
        ),
        { isRead: true }
      );
    }
    batch.update(doc(fs, "companies", companyId, "customer_conversations", conversationId), {
      unreadForAdminCount: 0,
    });
    void batch.commit().catch(() => {});
  }, [fs, companyId, conversationId, user.uid, messages]);

  const send = useCallback(async () => {
    if (!fs || !conversationId || !customerUid || !draft.trim()) return;
    const text = draft.trim();
    setSending(true);
    try {
      await addDoc(
        collection(
          fs,
          "companies",
          companyId,
          "customer_conversations",
          conversationId,
          "messages"
        ),
        {
          senderId: user.uid,
          senderRole: "admin",
          senderName: authorName,
          text,
          jobId,
          createdAt: serverTimestamp(),
          isRead: false,
          attachments: [],
        }
      );
      await setDoc(
        doc(fs, "companies", companyId, "customer_conversations", conversationId),
        {
          organizationId: companyId,
          customerUserId: customerUid,
          customerId: typeof job.customerId === "string" ? job.customerId : null,
          jobId,
          lastMessageAt: serverTimestamp(),
          lastMessagePreview: text.slice(0, 180),
          unreadForCustomerCount: increment(1),
          unreadForAdminCount: 0,
        },
        { merge: true }
      );
      setDraft("");
      const token = await user.getIdToken();
      void notifyJobActivity({
        idToken: token,
        companyId,
        jobId,
        eventType: "customer_job_chat",
        messagePreview: text,
        entityId: conversationId,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Zprávu se nepodařilo odeslat",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSending(false);
    }
  }, [
    fs,
    conversationId,
    customerUid,
    draft,
    companyId,
    jobId,
    job,
    user,
    authorName,
    toast,
  ]);

  if (!customerUid) {
    return (
      <Card className={cn("border border-border bg-background", className)}>
        <CardHeader>
          <CardTitle className="text-lg">Chat se zákazníkem</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Zakázka nemá přiřazeného zákazníka s přístupem do portálu. Nastavte zákazníka u
            zakázky nebo v CRM (portálový účet).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border border-border bg-background text-foreground shadow-sm", className)}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
          <span>Chat se zákazníkem</span>
          <Badge variant="secondary" className="text-[10px] font-normal">
            Zákazník
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <div className="min-h-[200px] max-h-[min(70vh,720px)] space-y-3 overflow-y-auto pr-1">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Načítám…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zatím žádné zprávy se zákazníkem k této zakázce.
            </p>
          ) : (
            messages.map((m) => {
              const mine = String(m.senderRole ?? "") === "admin";
              const author = String(m.senderName ?? (mine ? authorName : "Zákazník"));
              const role = authorRoleLabelCs(String(m.senderRole ?? ""));
              const sentAt = formatCsDateTimeDot(m.createdAt);
              const readLine =
                m.isRead === true
                  ? "přečteno"
                  : mine
                    ? "nepřečteno zákazníkem"
                    : "nepřečteno";
              return (
                <div
                  key={m.id}
                  className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[92%] min-w-0 rounded-2xl border bg-white px-3 py-2.5 shadow-sm break-words sm:max-w-[75%]",
                      mine
                        ? "border-emerald-300 rounded-br-md"
                        : "border-violet-200 rounded-bl-md"
                    )}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span className="font-semibold text-gray-900">{author}</span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {role}
                      </Badge>
                      <span>{sentAt}</span>
                    </div>
                    <ExpandableNoteText text={String(m.text ?? "")} />
                    <div className="mt-1.5 text-xs text-gray-600">{readLine}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-stretch">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Napište zprávu zákazníkovi…"
            className="min-h-[44px] min-w-0 flex-1"
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
            Odeslat zákazníkovi
          </Button>
        </div>
        {(conversation as { unreadForAdminCount?: number } | null)?.unreadForAdminCount ? (
          <p className="text-xs text-amber-700">
            Nepřečtené zprávy od zákazníka:{" "}
            {(conversation as { unreadForAdminCount?: number }).unreadForAdminCount}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
