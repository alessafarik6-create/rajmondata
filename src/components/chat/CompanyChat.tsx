"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useFirestore,
  useMemoFirebase,
  useUser,
  useDoc,
  useCollection,
} from "@/firebase";
import {
  addDoc,
  collection,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export type CompanyChatSenderMode = "employee" | "admin";

export type ChatMessageDoc = {
  id: string;
  senderId: string;
  senderRole: "employee" | "admin";
  text: string;
  createdAt?: { seconds?: number; nanoseconds?: number };
  read?: boolean;
};

type Props = {
  companyId: string;
  mode: CompanyChatSenderMode;
  title?: string;
  placeholder?: string;
};

export function CompanyChat({
  companyId,
  mode,
  title = "Zprávy",
  placeholder = "Napište zprávu…",
}: Props) {
  const firestore = useFirestore();
  const { user } = useUser();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc<any>(userRef);

  const chatQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "chat"),
      orderBy("createdAt", "asc")
    );
  }, [firestore, companyId]);

  const { data: rawMessages, isLoading, error } =
    useCollection<ChatMessageDoc>(chatQuery);

  const messages = useMemo<ChatMessageDoc[]>(() => {
    if (!Array.isArray(rawMessages)) return [];
    return rawMessages as ChatMessageDoc[];
  }, [rawMessages]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !user || !firestore || !companyId || sending) return;
    setSending(true);
    try {
      const senderRole: "employee" | "admin" =
        mode === "employee" ? "employee" : "admin";
      await addDoc(collection(firestore, "companies", companyId, "chat"), {
        companyId,
        senderId: user.uid,
        senderRole,
        text,
        read: false,
        createdAt: serverTimestamp(),
      });
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  const displayName =
    profile?.firstName ||
    profile?.displayName ||
    user?.email ||
    "Uživatel";

  return (
    <Card className="flex flex-1 flex-col overflow-hidden border-border bg-surface min-h-[420px] max-h-[calc(100vh-140px)]">
      <div className="border-b px-4 py-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground truncate">{displayName}</p>
      </div>

      {error ? (
        <Alert variant="destructive" className="m-4">
          <AlertTitle>Zprávy nelze načíst</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message || "Zkontrolujte oprávnění k Firestore."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            Zatím žádné zprávy. Napište první.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === user?.uid;
            const isEmployeeBubble = m.senderRole === "employee";
            return (
              <div
                key={m.id}
                className={cn(
                  "flex w-full",
                  mine ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                    mine
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : isEmployeeBubble
                        ? "bg-muted text-foreground rounded-bl-md"
                        : "bg-slate-200 text-slate-900 rounded-bl-md"
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  {!m.read && mode === "admin" && isEmployeeBubble ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs text-primary-foreground/90 underline"
                      onClick={() =>
                        void updateDoc(
                          doc(
                            firestore,
                            "companies",
                            companyId,
                            "chat",
                            m.id
                          ),
                          { read: true }
                        )
                      }
                    >
                      Označit jako přečtené
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t bg-background/40 p-3">
        <div className="flex items-end gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="min-h-[44px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            disabled={sending}
          />
          <Button
            type="button"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
