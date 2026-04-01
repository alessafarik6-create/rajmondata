"use client";

import React from "react";
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
} from "firebase/firestore";
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCustomerActivity } from "@/lib/customer-activity";
import { useToast } from "@/hooks/use-toast";

type Props = {
  companyId: string;
  linkedJobId?: string | null;
  compact?: boolean;
};

export function CustomerChatPanel({ companyId, linkedJobId = null, compact = false }: Props) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [text, setText] = React.useState("");
  const conversationId = user ? `cust_${user.uid}` : null;
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
            limit(300)
          )
        : null,
    [firestore, companyId, conversationId]
  );
  const { data: messages } = useCollection(messagesRef);

  React.useEffect(() => {
    if (!firestore || !user?.uid || !conversationId) return;
    void setDoc(
      doc(firestore, "companies", companyId, "customer_conversations", conversationId),
      {
        organizationId: companyId,
        customerUserId: user.uid,
        customerId: null,
        jobId: linkedJobId ?? null,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: "",
        unreadForAdminCount: 0,
        unreadForCustomerCount: 0,
      },
      { merge: true }
    );
  }, [firestore, companyId, user?.uid, conversationId, linkedJobId]);

  const send = async () => {
    if (!firestore || !user?.uid || !conversationId || !text.trim()) return;
    const msg = text.trim();
    const messagePayload = {
      senderId: user.uid,
      senderRole: "customer",
      text: msg,
      createdAt: serverTimestamp(),
      isRead: false,
      attachments: [],
    };
    if (process.env.NODE_ENV === "development") {
      console.log("customer chat message", messagePayload);
    }
    await addDoc(
      collection(
        firestore,
        "companies",
        companyId,
        "customer_conversations",
        conversationId,
        "messages"
      ),
      messagePayload
    );
    await setDoc(
      doc(firestore, "companies", companyId, "customer_conversations", conversationId),
      {
        organizationId: companyId,
        customerUserId: user.uid,
        customerId: null,
        jobId: linkedJobId ?? null,
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: msg.slice(0, 180),
        unreadForAdminCount: increment(1),
        unreadForCustomerCount: 0,
      },
      { merge: true }
    );
    await createCustomerActivity(firestore, {
      organizationId: companyId,
      jobId: linkedJobId ?? null,
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
    setText("");
    toast({ title: "Zpráva odeslána" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat s administrací</CardTitle>
        <CardDescription>
          {compact ? "Máte dotaz? Napište nám." : "Můžete nám poslat zprávu přímo z portálu."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-[380px] space-y-2 overflow-auto rounded border p-2">
          {(messages ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné zprávy.</p>
          ) : (
            (messages ?? []).map((m) => {
              const mine = (m as { senderRole?: string }).senderRole === "customer";
              return (
                <div
                  key={m.id}
                  className={`rounded px-3 py-2 text-sm ${
                    mine ? "ml-auto max-w-[85%] bg-primary/10" : "mr-auto max-w-[85%] bg-muted"
                  }`}
                >
                  <p>{String((m as { text?: string }).text ?? "")}</p>
                </div>
              );
            })
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Napište zprávu…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button type="button" onClick={() => void send()} disabled={!text.trim()}>
            Odeslat
          </Button>
        </div>
        {(conversation as { unreadForCustomerCount?: number } | null)?.unreadForCustomerCount ? (
          <p className="text-xs text-emerald-700">
            Máte {(conversation as { unreadForCustomerCount?: number }).unreadForCustomerCount} nepřečtených odpovědí.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

