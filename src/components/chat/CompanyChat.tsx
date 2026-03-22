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
  writeBatch,
} from "firebase/firestore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export type CompanyChatSenderMode = "employee" | "admin";

export type ChatMessageDoc = {
  id: string;
  senderId: string;
  senderRole: "employee" | "admin";
  text: string;
  createdAt?: { seconds?: number; nanoseconds?: number } | unknown;
  read?: boolean;
  companyId?: string;
  senderName?: string;
  senderPhotoURL?: string;
  employeeId?: string;
};

type Props = {
  companyId: string;
  mode: CompanyChatSenderMode;
  title?: string;
  placeholder?: string;
};

function formatMessageTime(createdAt: unknown): string {
  let d: Date | null = null;
  if (
    createdAt &&
    typeof createdAt === "object" &&
    "toDate" in createdAt &&
    typeof (createdAt as { toDate?: () => Date }).toDate === "function"
  ) {
    d = (createdAt as { toDate: () => Date }).toDate();
  } else if (
    createdAt &&
    typeof createdAt === "object" &&
    "seconds" in createdAt &&
    typeof (createdAt as { seconds?: unknown }).seconds === "number"
  ) {
    d = new Date((createdAt as { seconds: number }).seconds * 1000);
  }
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSenderNameFromProfile(profile: Record<string, unknown> | null | undefined): string {
  if (!profile) return "";
  const fn = String(profile.firstName ?? "").trim();
  const ln = String(profile.lastName ?? "").trim();
  const full = `${fn} ${ln}`.trim();
  if (full) return full;
  const dn = String(profile.displayName ?? "").trim();
  if (dn) return dn;
  return "";
}

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
  const { data: profile } = useDoc<Record<string, unknown>>(userRef);

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId]);

  const { data: employeeRows = [] } = useCollection<Record<string, unknown> & { id: string }>(
    employeesQuery
  );

  const employeesById = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    const rows = Array.isArray(employeeRows) ? employeeRows : [];
    for (const e of rows) {
      if (e?.id) m.set(e.id, e);
    }
    return m;
  }, [employeeRows]);

  const chatQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "chat"),
      orderBy("createdAt", "asc")
    );
  }, [firestore, companyId]);

  const { data: rawMessages, isLoading, error } = useCollection<ChatMessageDoc>(chatQuery);

  const messages = useMemo<ChatMessageDoc[]>(() => {
    if (!Array.isArray(rawMessages)) return [];
    return rawMessages as ChatMessageDoc[];
  }, [rawMessages]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastUnreadBatchKeyRef = useRef<string>("");

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  useEffect(() => {
    if (!companyId || mode !== "admin") return;
    console.log("Loading employee messages", { companyId });
  }, [companyId, mode]);

  const resolveSenderDisplay = (m: ChatMessageDoc): { name: string; photo: string } => {
    const nameStored = String(m.senderName ?? "").trim();
    const photoStored = String(m.senderPhotoURL ?? "").trim();
    if (nameStored && photoStored) return { name: nameStored, photo: photoStored };
    if (nameStored) return { name: nameStored, photo: photoStored };

    if (m.senderRole === "employee") {
      const byEmp = m.employeeId ? employeesById.get(m.employeeId) : undefined;
      const byUid = employeesById.get(m.senderId);
      const emp = byEmp || byUid;
      if (emp) {
        const fn = String(emp.firstName ?? "").trim();
        const ln = String(emp.lastName ?? "").trim();
        const full = `${fn} ${ln}`.trim();
        const photo =
          String(emp.profileImage ?? emp.photoURL ?? emp.photoUrl ?? "").trim() || photoStored;
        return {
          name: full || nameStored || "Zaměstnanec",
          photo,
        };
      }
    }
    return {
      name: nameStored || (m.senderRole === "admin" ? "Administrace" : "Neznámý zaměstnanec"),
      photo: photoStored,
    };
  };

  const unreadKey = useMemo(
    () =>
      messages
        .filter((m) => m.senderRole === "employee" && m.read !== true)
        .map((m) => m.id)
        .join(","),
    [messages]
  );

  useEffect(() => {
    if (mode !== "admin" || !firestore || !companyId) return;
    if (!unreadKey) {
      lastUnreadBatchKeyRef.current = "";
      return;
    }
    if (lastUnreadBatchKeyRef.current === unreadKey) return;
    const toMark = messages.filter((m) => m.senderRole === "employee" && m.read !== true);
    if (toMark.length === 0) return;

    lastUnreadBatchKeyRef.current = unreadKey;
    setMarkingRead(true);
    console.log("Marking message as read", { count: toMark.length });

    const batch = writeBatch(firestore);
    for (const m of toMark) {
      batch.update(doc(firestore, "companies", companyId, "chat", m.id), {
        read: true,
      });
    }
    void batch
      .commit()
      .catch((e) => {
        console.error(e);
        lastUnreadBatchKeyRef.current = "";
      })
      .finally(() => setMarkingRead(false));
  }, [mode, firestore, companyId, messages, unreadKey]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !user || !firestore || !companyId || sending) return;
    setSending(true);
    try {
      const senderRole: "employee" | "admin" = mode === "employee" ? "employee" : "admin";
      const displayName = buildSenderNameFromProfile(profile);
      const senderName =
        displayName ||
        String(profile?.email ?? user.email ?? "Uživatel").split("@")[0] ||
        "Uživatel";
      const senderPhotoURL = String(
        profile?.profileImage ??
          profile?.photoURL ??
          profile?.photoUrl ??
          user.photoURL ??
          ""
      );
      const employeeIdField =
        senderRole === "employee" && typeof profile?.employeeId === "string"
          ? profile.employeeId
          : "";

      await addDoc(collection(firestore, "companies", companyId, "chat"), {
        companyId,
        senderId: user.uid,
        senderRole,
        senderName,
        senderPhotoURL,
        employeeId: employeeIdField || "",
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
    buildSenderNameFromProfile(profile) ||
    String(profile?.email ?? user?.email ?? "") ||
    "Uživatel";

  return (
    <Card className="flex flex-1 flex-col overflow-hidden border-border bg-surface min-h-[420px] max-h-[calc(100vh-140px)]">
      <div className="border-b px-4 py-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground truncate">Píšete jako: {displayName}</p>
        {mode === "admin" && markingRead ? (
          <p className="text-[11px] text-muted-foreground mt-1">Označuji zprávy jako přečtené…</p>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="m-4">
          <AlertTitle>Zprávy nelze načíst</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message || "Zkontrolujte oprávnění k Firestore."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
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
            const { name: senderLabel, photo: senderPhoto } = resolveSenderDisplay(m);
            const timeLabel = formatMessageTime(m.createdAt);
            const unread =
              mode === "admin" && isEmployeeBubble && m.read !== true;

            return (
              <div
                key={m.id}
                className={cn(
                  "flex w-full gap-2",
                  mine ? "justify-end" : "justify-start"
                )}
              >
                {!mine && (
                  <Avatar className="h-9 w-9 shrink-0 border border-border">
                    <AvatarImage src={senderPhoto || undefined} className="object-cover" />
                    <AvatarFallback className="text-xs font-semibold">
                      {senderLabel.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={cn(
                    "min-w-0 max-w-[min(100%,28rem)] rounded-2xl border px-3 py-2 text-sm shadow-sm",
                    mine
                      ? "bg-primary text-primary-foreground border-primary/30 rounded-br-md"
                      : isEmployeeBubble
                        ? "bg-muted text-foreground border-border rounded-bl-md"
                        : "bg-slate-200 text-slate-900 border-slate-300 rounded-bl-md",
                    unread && "ring-2 ring-red-500 ring-offset-2 ring-offset-background"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="font-semibold leading-tight">{senderLabel}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                      {isEmployeeBubble ? "Zaměstnanec" : "Administrace"}
                    </Badge>
                    {unread ? (
                      <Badge
                        variant="destructive"
                        className="text-[10px] px-1.5 py-0 h-5"
                      >
                        Nepřečtené
                      </Badge>
                    ) : null}
                    {timeLabel ? (
                      <span
                        className={cn(
                          "text-[11px] ml-auto",
                          mine ? "text-primary-foreground/80" : "text-muted-foreground"
                        )}
                      >
                        {timeLabel}
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>
                </div>
                {mine && (
                  <Avatar className="h-9 w-9 shrink-0 border border-border">
                    <AvatarImage
                      src={
                        String(
                          profile?.profileImage ??
                            profile?.photoURL ??
                            profile?.photoUrl ??
                            user?.photoURL ??
                            ""
                        ) || undefined
                      }
                      className="object-cover"
                    />
                    <AvatarFallback className="text-xs font-semibold">
                      {displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
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
