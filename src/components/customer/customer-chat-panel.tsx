"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ExpandableNoteText } from "@/components/jobs/job-note-text-block";
import { createCustomerActivity } from "@/lib/customer-activity";
import {
  authorRoleLabelCs,
  customerChatMessageMatchesJob,
  customerConversationId,
} from "@/lib/job-customer-chat";
import { notifyJobActivity } from "@/lib/job-activity-notify-client";
import { useToast } from "@/hooks/use-toast";
import { formatCsDateTimeDot, safeTime } from "@/lib/date-safe";
import { cn } from "@/lib/utils";

type Props = {
  companyId: string;
  linkedJobId?: string | null;
  compact?: boolean;
  wide?: boolean;
  className?: string;
};

type MessageRow = Record<string, unknown> & { id: string };

export function CustomerChatPanel({
  companyId,
  linkedJobId = null,
  compact = false,
  wide = false,
  className,
}: Props) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const conversationId = user ? customerConversationId(user.uid) : null;
  const jobId = linkedJobId?.trim() || null;

  const conversationRef = useMemoFirebase(
    () =>
      firestore && conversationId
        ? doc(firestore, "companies", companyId, "customer_conversations", conversationId)
        : null,
    [firestore, companyId, conversationId]
  );
  const { data: conversation } = useDoc(conversationRef);
  const messagesRef = useMemoFirebase(
    () =>
      firestore && conversationId
        ? query(
            collection(
              firestore,
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
    [firestore, companyId, conversationId]
  );
  const { data: messagesRaw = [] } = useCollection(messagesRef);

  const messages = useMemo(() => {
    const list = (Array.isArray(messagesRaw) ? messagesRaw : []) as MessageRow[];
    if (!jobId) return list.slice().sort((a, b) => safeTime(a.createdAt) - safeTime(b.createdAt));
    return list
      .filter((m) => customerChatMessageMatchesJob(m, jobId, { includeLegacyWithoutJobId: true }))
      .slice()
      .sort((a, b) => safeTime(a.createdAt) - safeTime(b.createdAt));
  }, [messagesRaw, jobId]);

  useEffect(() => {
    if (!firestore || !user?.uid || !conversationId) return;
    void setDoc(
      doc(firestore, "companies", companyId, "customer_conversations", conversationId),
      {
        organizationId: companyId,
        customerUserId: user.uid,
        customerId: null,
        jobId: jobId ?? null,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: "",
        unreadForAdminCount: 0,
        unreadForCustomerCount: 0,
      },
      { merge: true }
    );
  }, [firestore, companyId, user?.uid, conversationId, jobId]);

  useEffect(() => {
    if (!firestore || !conversationId || !user?.uid) return;
    const unreadFromAdmin = messages.filter(
      (m) => String(m.senderRole ?? "") === "admin" && m.isRead !== true
    );
    if (!unreadFromAdmin.length) return;
    const batch = writeBatch(firestore);
    for (const m of unreadFromAdmin) {
      batch.update(
        doc(
          firestore,
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
    batch.update(doc(firestore, "companies", companyId, "customer_conversations", conversationId), {
      unreadForCustomerCount: 0,
    });
    void batch.commit().catch(() => {});
  }, [firestore, companyId, conversationId, user?.uid, messages]);

  const send = async () => {
    if (!firestore || !user?.uid || !conversationId || !text.trim()) return;
    const msg = text.trim();
    await addDoc(
      collection(
        firestore,
        "companies",
        companyId,
        "customer_conversations",
        conversationId,
        "messages"
      ),
      {
        senderId: user.uid,
        senderRole: "customer",
        senderName: "Zákazník",
        text: msg,
        jobId: jobId ?? null,
        createdAt: serverTimestamp(),
        isRead: false,
        attachments: [],
      }
    );
    await setDoc(
      doc(firestore, "companies", companyId, "customer_conversations", conversationId),
      {
        organizationId: companyId,
        customerUserId: user.uid,
        customerId: null,
        jobId: jobId ?? null,
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: msg.slice(0, 180),
        unreadForAdminCount: increment(1),
        unreadForCustomerCount: 0,
      },
      { merge: true }
    );
    await createCustomerActivity(firestore, {
      organizationId: companyId,
      jobId: jobId ?? null,
      customerUserId: user.uid,
      customerId: null,
      type: "customer_chat_message",
      title: "Nová zpráva zákazníka",
      message: msg.slice(0, 180),
      createdBy: user.uid,
      createdByRole: "customer",
      isRead: false,
      targetType: "chat",
      targetId: conversationId,
      targetLink: `/portal/customer-chats?conversationId=${encodeURIComponent(conversationId)}`,
      priority: "high",
    });
    try {
      const token = await user.getIdToken();
      if (jobId) {
        await notifyJobActivity({
          idToken: token,
          companyId,
          jobId,
          eventType: "customer_job_chat",
          messagePreview: msg,
          entityId: conversationId,
        });
      }
    } catch {
      // ignore
    }
    setText("");
    toast({ title: "Zpráva odeslána" });
  };

  const scrollClass = wide
    ? "min-h-[200px] max-h-[min(70vh,720px)] space-y-3 overflow-y-auto pr-1"
    : "max-h-[380px] space-y-3 overflow-y-auto rounded border border-border p-3";

  return (
    <Card className={cn(wide ? "border border-border shadow-sm" : "", className)}>
      <CardHeader className={compact ? "pb-2" : undefined}>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          {jobId ? "Chat k zakázce" : "Chat s administrací"}
          <Badge variant="secondary" className="text-[10px] font-normal">
            Zákazník
          </Badge>
        </CardTitle>
        <CardDescription>
          {jobId
            ? "Zprávy k této zakázce — stejný chat jako v administraci."
            : compact
              ? "Máte dotaz? Napište nám."
              : "Můžete nám poslat zprávu přímo z portálu."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={scrollClass}>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné zprávy.</p>
          ) : (
            messages.map((m) => {
              const mine = String(m.senderRole ?? "") === "customer";
              const author = String(m.senderName ?? (mine ? "Vy" : "Administrace"));
              const role = authorRoleLabelCs(String(m.senderRole ?? ""));
              const sentAt = formatCsDateTimeDot(m.createdAt);
              const readLine = m.isRead === true ? "přečteno" : mine ? "nepřečteno administrací" : "nepřečteno";
              return (
                <div
                  key={m.id}
                  className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[92%] min-w-0 rounded-2xl border bg-white px-3 py-2.5 shadow-sm break-words sm:max-w-[80%]",
                      mine
                        ? "border-violet-300 rounded-br-md"
                        : "border-emerald-200 rounded-bl-md"
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
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Napište zprávu administraci…"
            className="min-h-[44px] flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button type="button" className="min-h-[44px] shrink-0" onClick={() => void send()} disabled={!text.trim()}>
            Odeslat
          </Button>
        </div>
        {(conversation as { unreadForCustomerCount?: number } | null)?.unreadForCustomerCount ? (
          <p className="text-xs text-emerald-700">
            Máte {(conversation as { unreadForCustomerCount?: number }).unreadForCustomerCount}{" "}
            nepřečtených odpovědí.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
