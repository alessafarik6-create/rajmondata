"use client";

import React from "react";
import Link from "next/link";
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from "@/firebase";
import { addDoc, collection, doc, limit, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { createCustomerActivity } from "@/lib/customer-activity";

export default function CustomerProfilePage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [text, setText] = React.useState("");
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading } = useDoc(userRef);
  const companyId = (profile as { companyId?: string })?.companyId;
  const linkedJobIds = ((profile as { linkedJobIds?: string[] })?.linkedJobIds ?? []).filter(Boolean);
  const defaultJobId = linkedJobIds[0] ?? null;
  const conversationId = user && companyId ? `cust_${user.uid}` : null;
  const convoRef = useMemoFirebase(
    () =>
      firestore && companyId && conversationId
        ? doc(firestore, "companies", companyId, "customer_conversations", conversationId)
        : null,
    [firestore, companyId, conversationId]
  );
  const messagesRef = useMemoFirebase(
    () =>
      firestore && companyId && conversationId
        ? query(
            collection(firestore, "companies", companyId, "customer_conversations", conversationId, "messages"),
            orderBy("createdAt", "asc"),
            limit(200)
          )
        : null,
    [firestore, companyId, conversationId]
  );
  const { data: messages } = useCollection(messagesRef);

  const sendMessage = async () => {
    if (!user || !firestore || !companyId || !conversationId || !text.trim()) return;
    const body = text.trim();
    const messagePayload = {
      senderId: user.uid,
      senderRole: "customer",
      text: body,
      createdAt: serverTimestamp(),
      isRead: false,
      attachments: [],
    };
    if (process.env.NODE_ENV === "development") {
      console.log("customer chat message", messagePayload);
    }
    await setDoc(
      doc(firestore, "companies", companyId, "customer_conversations", conversationId),
      {
        organizationId: companyId,
        customerUserId: user.uid,
        customerId: null,
        jobId: defaultJobId,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: body.slice(0, 180),
        unreadForAdminCount: ((profile as { unreadForAdminCount?: number })?.unreadForAdminCount ?? 0) + 1,
        unreadForCustomerCount: 0,
      },
      { merge: true }
    );
    await addDoc(
      collection(firestore, "companies", companyId, "customer_conversations", conversationId, "messages"),
      messagePayload
    );
    await createCustomerActivity(firestore, {
      organizationId: companyId,
      jobId: defaultJobId,
      customerUserId: user.uid,
      customerId: null,
      type: "customer_chat_message",
      title: "Nová zpráva zákazníka",
      message: body.slice(0, 180),
      createdBy: user.uid,
      createdByRole: "customer",
      isRead: false,
      targetType: "chat",
      targetId: conversationId,
      targetLink: "/portal/dashboard",
      priority: "high",
    });
    setText("");
    toast({ title: "Zpráva odeslána" });
  };

  if (!user || isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const email = user.email || (profile as { email?: string })?.email || "—";
  const name =
    (profile as { displayName?: string })?.displayName ||
    `${(profile as { firstName?: string }).firstName || ""} ${(profile as { lastName?: string }).lastName || ""}`.trim() ||
    "—";

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/portal/customer" className="gap-1">
          <ChevronLeft className="h-4 w-4" />
          Přehled
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <CardDescription>Údaje vašeho účtu v klientském portálu.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Jméno:</span> {name}
          </p>
          <p>
            <span className="text-muted-foreground">E-mail:</span>{" "}
            <span className="select-all font-mono text-xs">{email}</span>
          </p>
          <p className="text-xs text-muted-foreground pt-2">
            Změnu hesla provedete přes „Zapomenuté heslo“ na přihlašovací stránce (odhlásíte se a použijete
            obnovení hesla), nebo vás může správce firmy provést z administrace zákazníka.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Chat s administrací</CardTitle>
          <CardDescription>Napište zprávu správci firmy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-[340px] space-y-2 overflow-auto rounded border p-2">
            {(messages ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím žádné zprávy.</p>
            ) : (
              (messages ?? []).map((m) => {
                const mine = (m as { senderRole?: string }).senderRole === "customer";
                return (
                  <div
                    key={m.id}
                    className={`rounded px-3 py-2 text-sm ${mine ? "ml-auto max-w-[85%] bg-primary/10" : "mr-auto max-w-[85%] bg-muted"}`}
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
                  void sendMessage();
                }
              }}
            />
            <Button type="button" onClick={() => void sendMessage()} disabled={!text.trim()}>
              Odeslat
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
