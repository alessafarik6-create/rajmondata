"use client";

import React from "react";
import { addDoc, collection, doc, increment, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { useCollection, useCompany, useFirestore, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSearchParams } from "next/navigation";

export default function CustomerChatsPage() {
  const firestore = useFirestore();
  const { companyId } = useCompany();
  const searchParams = useSearchParams();
  const conversationIdFromUrl = (searchParams.get("conversationId") || "").trim();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const convRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? query(collection(firestore, "companies", companyId, "customer_conversations"), orderBy("lastMessageAt", "desc"))
        : null,
    [firestore, companyId]
  );
  const { data: conversations } = useCollection(convRef);
  React.useEffect(() => {
    if (!conversationIdFromUrl) return;
    setSelectedId(conversationIdFromUrl);
  }, [conversationIdFromUrl]);
  const selected = React.useMemo(() => {
    const list = conversations ?? [];
    if (!list.length) return null;
    if (selectedId) return list.find((c) => c.id === selectedId) ?? list[0];
    if (conversationIdFromUrl) return list.find((c) => c.id === conversationIdFromUrl) ?? list[0];
    return list[0];
  }, [conversations, selectedId, conversationIdFromUrl]);
  const messagesRef = useMemoFirebase(
    () =>
      firestore && companyId && selected
        ? query(collection(firestore, "companies", companyId, "customer_conversations", selected.id, "messages"), orderBy("createdAt", "asc"))
        : null,
    [firestore, companyId, selected?.id]
  );
  const { data: messages } = useCollection(messagesRef);
  const customerId = (selected as { customerId?: string } | null)?.customerId ?? null;
  const jobId = (selected as { jobId?: string } | null)?.jobId ?? null;
  const memoizedChatParams = React.useMemo(
    () => ({
      conversationId: selected?.id ?? null,
      customerId,
      jobId,
    }),
    [selected?.id, customerId, jobId]
  );
  if (process.env.NODE_ENV === "development") {
    console.log("conversationId", conversationIdFromUrl || selected?.id || null);
    console.log("customer chat params", {
      conversationId: selected?.id ?? null,
      customerId,
      jobId,
    });
    console.log("memoized chat params", memoizedChatParams);
    console.log("resolved conversation", selected ?? null);
  }

  const sendAdminReply = async () => {
    if (!firestore || !companyId || !selected || !text.trim()) return;
    await addDoc(collection(firestore, "companies", companyId, "customer_conversations", selected.id, "messages"), {
      senderId: "admin",
      senderRole: "admin",
      text: text.trim(),
      createdAt: serverTimestamp(),
      isRead: false,
      attachments: [],
    });
    await setDoc(
      doc(firestore, "companies", companyId, "customer_conversations", selected.id),
      {
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: text.trim().slice(0, 180),
        unreadForCustomerCount: increment(1),
        unreadForAdminCount: 0,
      },
      { merge: true }
    );
    setText("");
  };

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[320px,1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Zákaznické chaty</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(conversations ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím nejsou žádné konverzace.</p>
          ) : null}
          {(conversations ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              className={`w-full rounded border p-2 text-left ${selected?.id === c.id ? "border-primary bg-primary/5" : ""}`}
              onClick={() => setSelectedId(c.id)}
            >
              <p className="font-medium">{String((c as { customerUserId?: string }).customerUserId ?? c.id)}</p>
              <p className="text-xs text-muted-foreground">{String((c as { lastMessagePreview?: string }).lastMessagePreview ?? "")}</p>
            </button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Konverzace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Konverzace nebyla nalezena.</p>
          ) : null}
          <div className="max-h-[60vh] space-y-2 overflow-auto rounded border p-2">
            {!selected ? null : (messages ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Chat zatím neobsahuje žádné zprávy.</p>
            ) : (
              (messages ?? []).map((m) => (
                <div key={m.id} className={`rounded px-3 py-2 text-sm ${(m as { senderRole?: string }).senderRole === "admin" ? "ml-auto max-w-[80%] bg-primary/10" : "mr-auto max-w-[80%] bg-muted"}`}>
                  {String((m as { text?: string }).text ?? "")}
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Odpověď zákazníkovi…" />
            <Button type="button" onClick={() => void sendAdminReply()} disabled={!text.trim() || !selected}>
              Odeslat
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

