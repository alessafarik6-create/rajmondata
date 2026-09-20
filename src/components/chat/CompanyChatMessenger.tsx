"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useFirestore,
  useMemoFirebase,
  useUser,
  useDoc,
  useCollection,
} from "@/firebase";
import {
  collection,
  doc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  Paperclip,
  Send,
  Video,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { sendModuleEmailNotificationFromBrowser } from "@/lib/email-notifications/client";
import { formatDateSafe } from "@/lib/date-safe";
import {
  buildDirectConversationId,
  chatAttachmentStoragePath,
  COMPANY_CHAT_CONVERSATION_ID,
  directMessageParticipantIds,
  messageConversationKey,
  type ChatAttachmentMeta,
  type ChatMessageDoc,
} from "@/lib/company-chat-types";
import { ChatAssignJobDialog } from "@/components/chat/chat-assign-job-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";

export type CompanyChatSenderMode = "employee" | "admin";

type Props = {
  companyId: string;
  mode: CompanyChatSenderMode;
  title?: string;
  placeholder?: string;
  readOnly?: boolean;
};

type ConversationItem = {
  id: string;
  label: string;
  subtitle?: string;
  peerUserId?: string | null;
  employeeId?: string | null;
  photo?: string;
};

function formatMessageTime(createdAt: unknown): string {
  const s = formatDateSafe(createdAt);
  return s === "bez data" ? "" : s;
}

function buildSenderNameFromProfile(profile: Record<string, unknown> | null | undefined): string {
  if (!profile) return "";
  const fn = String(profile.firstName ?? "").trim();
  const ln = String(profile.lastName ?? "").trim();
  const full = `${fn} ${ln}`.trim();
  if (full) return full;
  return String(profile.displayName ?? "").trim();
}

function isMediaMime(m: string): boolean {
  const t = m.toLowerCase();
  return t.startsWith("image/") || t.startsWith("video/");
}

export function CompanyChatMessenger({
  companyId,
  mode,
  title = "Zprávy",
  placeholder = "Napište zprávu…",
  readOnly = false,
}: Props) {
  const firestore = useFirestore();
  const { user } = useUser();
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const jobsAccess = usePortalModuleAccess("jobs");

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc<Record<string, unknown>>(userRef);

  const readStateRef = useMemoFirebase(() => {
    if (!firestore || !companyId || !user?.uid) return null;
    return doc(firestore, "companies", companyId, "chatReadState", user.uid);
  }, [firestore, companyId, user?.uid]);
  const { data: readState } = useDoc<{ lastReadAt?: Record<string, unknown> }>(readStateRef);

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId]);
  const { data: employeeRows = [] } = useCollection<Record<string, unknown> & { id: string }>(
    employeesQuery
  );

  const employeesById = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const e of employeeRows ?? []) {
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
  const messages = useMemo(
    () => (Array.isArray(rawMessages) ? (rawMessages as ChatMessageDoc[]) : []),
    [rawMessages]
  );

  const conversations = useMemo((): ConversationItem[] => {
    const list: ConversationItem[] = [
      { id: COMPANY_CHAT_CONVERSATION_ID, label: "Firemní chat" },
    ];
    if (mode === "admin") {
      for (const e of employeeRows ?? []) {
        const authUid = String(e.authUserId ?? "").trim();
        if (!authUid || authUid === user?.uid) continue;
        const fn = String(e.firstName ?? "").trim();
        const ln = String(e.lastName ?? "").trim();
        const label = `${fn} ${ln}`.trim() || String(e.email ?? "Zaměstnanec");
        const dmId = buildDirectConversationId(user?.uid ?? "", authUid);
        list.push({
          id: dmId,
          label,
          peerUserId: authUid,
          employeeId: e.id,
          photo: String(e.profileImage ?? e.photoURL ?? ""),
        });
      }
    }
    return list;
  }, [employeeRows, mode, user?.uid]);

  const initialConv =
    searchParams.get("c")?.trim() ||
    (mode === "employee" ? COMPANY_CHAT_CONVERSATION_ID : COMPANY_CHAT_CONVERSATION_ID);
  const [activeConversationId, setActiveConversationId] = useState(initialConv);
  const [mobileShowThread, setMobileShowThread] = useState(false);

  useEffect(() => {
    const c = searchParams.get("c")?.trim();
    if (c) setActiveConversationId(c);
  }, [searchParams]);

  const filteredMessages = useMemo(
    () => messages.filter((m) => messageConversationKey(m) === activeConversationId),
    [messages, activeConversationId]
  );

  const lastPreviewByConv = useMemo(() => {
    const m = new Map<string, ChatMessageDoc>();
    for (const msg of messages) {
      const k = messageConversationKey(msg);
      m.set(k, msg);
    }
    return m;
  }, [messages]);

  const unreadByConv = useMemo(() => {
    const counts = new Map<string, number>();
    const lastRead = (readState?.lastReadAt ?? {}) as Record<string, unknown>;
    for (const msg of messages) {
      const k = messageConversationKey(msg);
      if (msg.senderId === user?.uid) continue;
      if (k === COMPANY_CHAT_CONVERSATION_ID && mode === "admin") {
        if (msg.senderRole === "employee" && msg.read !== true) {
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        continue;
      }
      const lr = lastRead[k];
      const lrMs =
        lr && typeof (lr as { toMillis?: () => number }).toMillis === "function"
          ? (lr as { toMillis: () => number }).toMillis()
          : 0;
      const msgMs =
        msg.createdAt && typeof (msg.createdAt as { seconds?: number }).seconds === "number"
          ? Number((msg.createdAt as { seconds: number }).seconds) * 1000
          : Date.now();
      if (msgMs > lrMs) {
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    return counts;
  }, [messages, readState, user?.uid, mode]);

  const markConversationRead = useCallback(async () => {
    if (!firestore || !companyId || !user?.uid || !readStateRef) return;
    const patch: Record<string, unknown> = {
      userId: user.uid,
      updatedAt: serverTimestamp(),
    };
    patch[`lastReadAt.${activeConversationId}`] = serverTimestamp();
    await setDoc(readStateRef, patch, { merge: true });

    if (mode === "admin" && activeConversationId === COMPANY_CHAT_CONVERSATION_ID) {
      const toMark = filteredMessages.filter(
        (m) => m.senderRole === "employee" && m.read !== true
      );
      if (toMark.length === 0) return;
      const batch = writeBatch(firestore);
      for (const m of toMark) {
        batch.update(doc(firestore, "companies", companyId, "chat", m.id), { read: true });
      }
      await batch.commit().catch(() => {});
    }
  }, [
    firestore,
    companyId,
    user?.uid,
    readStateRef,
    activeConversationId,
    mode,
    filteredMessages,
  ]);

  useEffect(() => {
    if (mobileShowThread || !isMobile) void markConversationRead();
  }, [activeConversationId, filteredMessages.length, markConversationRead, isMobile, mobileShowThread]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredMessages.length, activeConversationId]);

  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const activeConvMeta = conversations.find((c) => c.id === activeConversationId);

  const resolveSenderDisplay = (m: ChatMessageDoc): { name: string; photo: string } => {
    const nameStored = String(m.senderName ?? "").trim();
    const photoStored = String(m.senderPhotoURL ?? "").trim();
    if (m.senderRole === "employee") {
      const emp = m.employeeId ? employeesById.get(m.employeeId) : undefined;
      if (emp) {
        const fn = String(emp.firstName ?? "").trim();
        const ln = String(emp.lastName ?? "").trim();
        return {
          name: `${fn} ${ln}`.trim() || nameStored || "Zaměstnanec",
          photo: String(emp.profileImage ?? emp.photoURL ?? photoStored),
        };
      }
    }
    return {
      name: nameStored || (m.senderRole === "admin" ? "Administrace" : "Uživatel"),
      photo: photoStored,
    };
  };

  const notifyRecipient = async (recipientUserId: string, hasAttachment: boolean, preview: string) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      await fetch("/api/company/chat/notify", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId,
          recipientUserId,
          senderName: buildSenderNameFromProfile(profile) || "RAJMONDATA",
          previewText: preview,
          conversationId: activeConversationId,
          hasAttachment,
        }),
      });
    } catch {
      /* ignore */
    }
  };

  const handleSend = async () => {
    if (readOnly || !user || !firestore || !companyId || sending) return;
    const text = draft.trim();
    if (!text && pendingFiles.length === 0) return;
    setSending(true);
    try {
      const senderRole: "employee" | "admin" = mode === "employee" ? "employee" : "admin";
      const senderName =
        buildSenderNameFromProfile(profile) ||
        String(profile?.email ?? user.email ?? "Uživatel").split("@")[0] ||
        "Uživatel";
      const senderPhotoURL = String(
        profile?.profileImage ?? profile?.photoURL ?? profile?.photoUrl ?? user.photoURL ?? ""
      );
      const employeeIdField =
        senderRole === "employee" && typeof profile?.employeeId === "string"
          ? profile.employeeId
          : "";

      const isCompany = activeConversationId === COMPANY_CHAT_CONVERSATION_ID;
      const peerUid = activeConvMeta?.peerUserId ?? null;
      const participantIds =
        !isCompany && peerUid
          ? directMessageParticipantIds(user.uid, peerUid)
          : [user.uid];
      const recipientUserId = !isCompany && peerUid ? peerUid : null;

      const msgRef = doc(collection(firestore, "companies", companyId, "chat"));
      const attachments: ChatAttachmentMeta[] = [];
      const storage = getFirebaseStorage();
      if (storage && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          const attId = crypto.randomUUID();
          const path = chatAttachmentStoragePath(
            companyId,
            activeConversationId,
            msgRef.id,
            attId,
            file.name
          );
          const sref = ref(storage, path);
          await uploadBytes(sref, file, { contentType: file.type || undefined });
          const downloadUrl = await getDownloadURL(sref);
          attachments.push({
            id: attId,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            storagePath: path,
            downloadUrl,
          });
        }
      }

      await setDoc(msgRef, {
        companyId,
        senderId: user.uid,
        senderRole,
        senderName,
        senderPhotoURL,
        employeeId: employeeIdField || "",
        text: text || (attachments.length ? "📎 Příloha" : ""),
        read: false,
        conversationId: activeConversationId,
        participantIds,
        recipientUserId,
        attachments,
        createdAt: serverTimestamp(),
      });

      if (isCompany) {
        void sendModuleEmailNotificationFromBrowser({
          companyId,
          module: "messages",
          eventKey: "newInternalMessage",
          entityId: msgRef.id,
          title:
            senderRole === "employee"
              ? "Nová interní zpráva od zaměstnance"
              : "Nová interní zpráva",
          lines: [senderName, (text || "Příloha").slice(0, 240)].filter(Boolean),
          actionPath: "/portal/chat",
        });
      } else if (recipientUserId) {
        void notifyRecipient(recipientUserId, attachments.length > 0, text);
      }

      setDraft("");
      setPendingFiles([]);
    } finally {
      setSending(false);
    }
  };

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{
    messageId: string;
    attachmentIds: string[];
    senderLabel: string;
  } | null>(null);
  const [assigning, setAssigning] = useState(false);

  const runAssign = async (jobId: string, jobLabel: string) => {
    if (!assignTarget || !user) return;
    setAssigning(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/chat/assign-media", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId,
          jobId,
          messageId: assignTarget.messageId,
          conversationId: activeConversationId,
          attachmentIds: assignTarget.attachmentIds,
          jobDisplayName: jobLabel,
          senderLabel: assignTarget.senderLabel,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        alert(j.error || "Přiřazení se nepodařilo.");
        return;
      }
      setAssignOpen(false);
      setAssignTarget(null);
    } finally {
      setAssigning(false);
    }
  };

  const displayName =
    buildSenderNameFromProfile(profile) ||
    String(profile?.email ?? user?.email ?? "") ||
    "Uživatel";

  const pickFiles = (files: FileList | null, kind: "any" | "image" | "video") => {
    if (!files?.length) return;
    const next: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f) continue;
      const t = f.type.toLowerCase();
      if (kind === "image" && !t.startsWith("image/")) continue;
      if (kind === "video" && !t.startsWith("video/")) continue;
      if (kind === "any" && !isMediaMime(t) && !t.includes("pdf")) continue;
      next.push(f);
    }
    setPendingFiles((prev) => [...prev, ...next].slice(0, 8));
  };

  const openConversation = (id: string) => {
    setActiveConversationId(id);
    if (isMobile) setMobileShowThread(true);
    void markConversationRead();
  };

  const sidebar = (
    <div className="flex flex-col border-r border-border min-h-0">
      <div className="px-3 py-2 border-b font-semibold text-sm">{title}</div>
      <ul className="flex-1 overflow-y-auto text-sm">
        {conversations.map((c) => {
          const prev = lastPreviewByConv.get(c.id);
          const unread = unreadByConv.get(c.id) ?? 0;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => openConversation(c.id)}
                className={cn(
                  "w-full px-3 py-2.5 text-left hover:bg-muted/50 border-b border-border/40",
                  activeConversationId === c.id && "bg-muted/70"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate flex-1">{c.label}</span>
                  {unread > 0 ? (
                    <Badge variant="destructive" className="h-5 min-w-5 px-1 text-[10px]">
                      {unread}
                    </Badge>
                  ) : null}
                </div>
                {prev ? (
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {prev.text?.slice(0, 60) || "📎 Média"}
                    {" · "}
                    {formatMessageTime(prev.createdAt)}
                  </p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const thread = (
    <>
      <div className="border-b px-3 py-2 flex items-center gap-2">
        {isMobile ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMobileShowThread(false)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <h2 className="text-sm font-semibold truncate">
          {activeConvMeta?.label ?? "Chat"}
        </h2>
        <span className="text-xs text-muted-foreground ml-auto truncate">
          {displayName}
        </span>
      </div>

      {error ? (
        <Alert variant="destructive" className="m-3">
          <AlertTitle>Zprávy nelze načíst</AlertTitle>
          <AlertDescription>{(error as Error)?.message || "Chyba oprávnění."}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredMessages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">Zatím žádné zprávy.</p>
        ) : (
          filteredMessages.map((m) => {
            const mine = m.senderId === user?.uid;
            const { name: senderLabel, photo: senderPhoto } = resolveSenderDisplay(m);
            return (
              <div key={m.id} className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}>
                {!mine && (
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={senderPhoto || undefined} />
                    <AvatarFallback>{senderLabel.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={cn(
                    "max-w-[min(100%,28rem)] rounded-2xl border px-3 py-2 text-sm",
                    mine ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  <div className="text-[11px] font-semibold mb-1">{senderLabel}</div>
                  {m.text ? (
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  ) : null}
                  {(m.attachments ?? []).map((att) => (
                    <div key={att.id} className="mt-2 space-y-1">
                      {att.mimeType.startsWith("image/") ? (
                        <a href={att.downloadUrl ?? "#"} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={att.downloadUrl ?? ""}
                            alt={att.fileName}
                            className="max-h-48 rounded-md border object-cover"
                          />
                        </a>
                      ) : att.mimeType.startsWith("video/") ? (
                        <video
                          controls
                          className="max-h-48 max-w-full rounded-md"
                          src={att.downloadUrl ?? undefined}
                        />
                      ) : (
                        <a
                          href={att.downloadUrl ?? "#"}
                          className="underline text-xs"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {att.fileName}
                        </a>
                      )}
                      {att.linkedJobId && jobsAccess.canRead ? (
                        <p className="text-[11px] opacity-90">
                          Přiřazeno k: {att.linkedJobName ?? att.linkedJobId}{" "}
                          <Link
                            href={`/portal/jobs/${encodeURIComponent(att.linkedJobId)}`}
                            className="underline font-medium"
                          >
                            Otevřít zakázku
                          </Link>
                        </p>
                      ) : jobsAccess.canWrite ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() => {
                            setAssignTarget({
                              messageId: m.id,
                              attachmentIds: [att.id],
                              senderLabel,
                            });
                            setAssignOpen(true);
                          }}
                        >
                          Přiřadit k zakázce
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {(m.attachments?.length ?? 0) > 1 && jobsAccess.canWrite ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-7 text-[11px]"
                      onClick={() => {
                        setAssignTarget({
                          messageId: m.id,
                          attachmentIds: (m.attachments ?? []).map((a) => a.id),
                          senderLabel,
                        });
                        setAssignOpen(true);
                      }}
                    >
                      Přiřadit všechny k zakázce
                    </Button>
                  ) : null}
                  <div className="text-[10px] opacity-70 mt-1 text-right">
                    {formatMessageTime(m.createdAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {!readOnly ? (
        <div className="border-t p-2 space-y-2">
          {pendingFiles.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {pendingFiles.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1 rounded border px-2 py-1 text-[11px] bg-muted/40"
                >
                  <span className="truncate max-w-[120px]">{f.name}</span>
                  <span className="text-muted-foreground">
                    ({Math.round(f.size / 1024)} KB)
                  </span>
                  <button type="button" onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-end gap-1">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept="image/*,video/*,.pdf"
              onChange={(e) => pickFiles(e.target.files, "any")}
            />
            <input
              ref={photoInputRef}
              type="file"
              className="hidden"
              multiple
              accept="image/*"
              capture="environment"
              onChange={(e) => pickFiles(e.target.files, "image")}
            />
            <input
              ref={videoInputRef}
              type="file"
              className="hidden"
              accept="video/*"
              capture="environment"
              onChange={(e) => pickFiles(e.target.files, "video")}
            />
            <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => photoInputRef.current?.click()}>
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => videoInputRef.current?.click()}>
              <Video className="h-4 w-4" />
            </Button>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              className="min-h-[40px]"
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
              className="shrink-0"
              disabled={sending || (!draft.trim() && pendingFiles.length === 0)}
              onClick={() => void handleSend()}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <Card className="flex flex-col overflow-hidden min-h-[420px] max-h-[calc(100vh-120px)] md:max-h-[calc(100vh-140px)]">
        <div className="flex flex-1 min-h-0">
          {isMobile ? (
            mobileShowThread ? (
              <div className="flex flex-col flex-1 min-h-0">{thread}</div>
            ) : (
              <div className="flex flex-col flex-1 min-h-0">{sidebar}</div>
            )
          ) : (
            <>
              <div className="w-56 lg:w-64 shrink-0 flex flex-col min-h-0">{sidebar}</div>
              <div className="flex flex-col flex-1 min-h-0">{thread}</div>
            </>
          )}
        </div>
      </Card>
      <ChatAssignJobDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        companyId={companyId}
        onAssign={runAssign}
        assigning={assigning}
      />
    </>
  );
}
