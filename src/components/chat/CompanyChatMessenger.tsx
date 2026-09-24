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
  where,
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
  Plus,
  Send,
  Users,
  Video,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { sendModuleEmailNotificationFromBrowser } from "@/lib/email-notifications/client";
import {
  formatChatDaySeparator,
  formatMessageAuthorDateTime,
  formatChatTimestampDisplay,
} from "@/lib/format-chat-timestamp";
import {
  companyEmployeeMessageReadByAdmin,
  dmPeerReadAtMs,
  formatReadReceiptTime,
  groupReadCount,
} from "@/lib/chat-read-receipt";
import {
  buildMessageAuthorPersistFields,
  buildMessageTimestampClientFields,
  messageTimestampFromRecord,
  messageTimestampMs,
} from "@/lib/format-message-date";
import {
  displayNameFromUserRecord,
  resolveChatSenderDisplay,
  type ChatParticipantProfile,
} from "@/lib/chat-participant-profile";
import {
  buildDirectConversationId,
  chatAttachmentStoragePath,
  COMPANY_CHAT_CONVERSATION_ID,
  directMessageParticipantIds,
  isGroupConversationId,
  messageConversationKey,
  newGroupConversationId,
  type ChatAttachmentMeta,
  type ChatConversationDoc,
  type ChatMessageDoc,
} from "@/lib/company-chat-types";
import { ChatAssignJobDialog } from "@/components/chat/chat-assign-job-dialog";
import {
  ChatAssignProgressDialog,
  type AssignProgressPhase,
} from "@/components/chat/chat-assign-progress-dialog";
import {
  ChatNewConversationDialog,
  type ChatEmployeeOption,
} from "@/components/chat/chat-new-conversation-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { ChatAttachmentDocumentPanel } from "@/components/chat/chat-attachment-document-panel";

export type CompanyChatSenderMode = "employee" | "admin";

type Props = {
  companyId: string;
  mode: CompanyChatSenderMode;
  title?: string;
  placeholder?: string;
  readOnly?: boolean;
  fullScreenMobile?: boolean;
};

type ConversationItem = {
  id: string;
  label: string;
  subtitle?: string;
  peerUserId?: string | null;
  employeeId?: string | null;
  photo?: string;
  isGroup?: boolean;
  participantIds?: string[];
};

type SenderDisplay = { name: string; photo: string; roleLabel: string | null };

function MessageAuthorMeta({
  mine,
  sender,
  message,
  className,
  readReceiptLine,
}: {
  mine: boolean;
  sender: SenderDisplay;
  message: ChatMessageDoc;
  className?: string;
  readReceiptLine?: string | null;
}) {
  const timeLabel = formatMessageAuthorDateTime(
    messageTimestampFromRecord(message as Record<string, unknown>)
  );
  const authorLabel = mine ? "Vy" : sender.name;
  const authorLine = `${authorLabel} · ${timeLabel}`;
  return (
    <div className={cn("text-[11px] leading-snug mb-1.5", className)}>
      <div className={cn("font-semibold", mine && "text-primary-foreground")}>{authorLine}</div>
      {!mine && sender.roleLabel ? (
        <div className="opacity-75 font-normal text-[10px] mt-0.5">{sender.roleLabel}</div>
      ) : null}
      {mine && readReceiptLine ? (
        <div className="opacity-80 font-normal text-[10px] mt-0.5">{readReceiptLine}</div>
      ) : null}
    </div>
  );
}

function buildReadReceiptLine(
  message: ChatMessageDoc,
  ctx: {
    conversationId: string;
    peerUserId?: string | null;
    participantIds?: string[];
    myUserId?: string;
    mode: CompanyChatSenderMode;
  }
): string | null {
  const isCompany = ctx.conversationId === COMPANY_CHAT_CONVERSATION_ID;
  if (isCompany && ctx.mode === "employee" && message.senderRole === "employee") {
    return companyEmployeeMessageReadByAdmin(message) ? "Přečteno administrací" : "Odesláno";
  }
  if (isCompany && ctx.mode === "admin" && message.senderRole === "employee") {
    return null;
  }
  if (isGroupConversationId(ctx.conversationId)) {
    const { read, total } = groupReadCount(message, ctx.participantIds, ctx.myUserId);
    if (total <= 0) return "Odesláno";
    if (read >= total) return `Přečteno · ${read}/${total}`;
    if (read > 0) return `Doručeno · přečetlo ${read}/${total}`;
    return "Odesláno";
  }
  if (!isCompany) {
    const peer = ctx.peerUserId ?? message.recipientUserId ?? null;
    const readMs = dmPeerReadAtMs(message, peer);
    if (readMs != null) return `Přečteno ${formatReadReceiptTime(readMs)}`;
    return "Odesláno";
  }
  return "Odesláno";
}

function buildSenderNameFromProfile(profile: Record<string, unknown> | null | undefined): string {
  return displayNameFromUserRecord(profile ?? {});
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
  fullScreenMobile = false,
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
  const role = String(profile?.role ?? "").trim();
  const canManageGroups =
    mode === "admin" && ["owner", "admin", "manager"].includes(role);

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

  const employeesByAuthUid = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const e of employeeRows ?? []) {
      const uid = String(e.authUserId ?? "").trim();
      if (uid) m.set(uid, e);
    }
    return m;
  }, [employeeRows]);

  const [chatContacts, setChatContacts] = useState<ChatParticipantProfile[]>([]);

  useEffect(() => {
    if (!user || !companyId) {
      setChatContacts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/company/chat/contacts?companyId=${encodeURIComponent(companyId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          contacts?: Array<{
            userId: string;
            displayName: string;
            role: string;
            roleLabel: string;
            photoUrl?: string | null;
            employeeId?: string | null;
          }>;
        };
        if (cancelled) return;
        const list: ChatParticipantProfile[] = (j.contacts ?? []).map((c) => ({
          userId: c.userId,
          displayName: c.displayName,
          role: c.role,
          roleLabel: c.roleLabel,
          photoUrl: String(c.photoUrl ?? ""),
          employeeId: c.employeeId ? String(c.employeeId) : null,
          email: "",
        }));
        setChatContacts(list);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, companyId]);

  const participantsByUserId = useMemo(() => {
    const m = new Map<string, ChatParticipantProfile>();
    for (const c of chatContacts) m.set(c.userId, c);
    return m;
  }, [chatContacts]);

  const senderContext = useMemo(
    () => ({
      currentUserId: user?.uid,
      profile,
      participantsByUserId,
      employeesById,
      employeesByAuthUid,
    }),
    [user?.uid, profile, participantsByUserId, employeesById, employeesByAuthUid]
  );

  const groupConvQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !user?.uid) return null;
    return query(
      collection(firestore, "companies", companyId, "chatConversations"),
      where("participantIds", "array-contains", user.uid)
    );
  }, [firestore, companyId, user?.uid]);
  const { data: groupConvRaw = [] } = useCollection<ChatConversationDoc>(groupConvQuery);

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

  const groupById = useMemo(() => {
    const m = new Map<string, ChatConversationDoc>();
    for (const g of groupConvRaw ?? []) {
      if (g?.id) m.set(g.id, g as ChatConversationDoc);
    }
    return m;
  }, [groupConvRaw]);

  const chatContactOptions = useMemo((): ChatEmployeeOption[] => {
    return chatContacts.map((c) => ({
      employeeId: c.employeeId,
      authUserId: c.userId,
      label: c.displayName,
      roleLabel: c.roleLabel,
    }));
  }, [chatContacts]);

  const peerLabelFromUid = useCallback(
    (peerUid: string | null | undefined): string => {
      const uid = String(peerUid ?? "").trim();
      if (!uid) return "Soukromý chat";
      const p = participantsByUserId.get(uid);
      return p?.displayName ?? "Soukromý chat";
    },
    [participantsByUserId]
  );

  const conversations = useMemo((): ConversationItem[] => {
    const list: ConversationItem[] = [
      { id: COMPANY_CHAT_CONVERSATION_ID, label: "Firemní chat" },
    ];
    for (const g of groupById.values()) {
      if (g.type !== "group") continue;
      list.push({
        id: g.id,
        label: String(g.name ?? "Skupina"),
        isGroup: true,
        participantIds: g.participantIds ?? [],
      });
    }
    const seenDm = new Set(list.map((c) => c.id));
    if (user?.uid) {
      for (const c of chatContactOptions) {
        const dmId = buildDirectConversationId(user.uid, c.authUserId);
        if (!dmId || seenDm.has(dmId)) continue;
        seenDm.add(dmId);
        const peer = participantsByUserId.get(c.authUserId);
        list.push({
          id: dmId,
          label: c.label,
          subtitle: c.roleLabel,
          peerUserId: c.authUserId,
          employeeId: c.employeeId ?? undefined,
          photo: peer?.photoUrl,
        });
      }
      for (const msg of messages) {
        const k = messageConversationKey(msg);
        if (k === COMPANY_CHAT_CONVERSATION_ID || isGroupConversationId(k) || seenDm.has(k)) {
          continue;
        }
        const pids = msg.participantIds ?? [];
        if (!pids.includes(user.uid) || pids.length < 2) continue;
        seenDm.add(k);
        const peerUid = pids.find((uid) => uid !== user.uid) ?? null;
        const peer = peerUid ? participantsByUserId.get(peerUid) : undefined;
        list.push({
          id: k,
          label: peer?.displayName ?? peerLabelFromUid(peerUid),
          subtitle: peer?.roleLabel,
          peerUserId: peerUid,
          photo: peer?.photoUrl,
        });
      }
    }
    return list;
  }, [groupById, chatContactOptions, user?.uid, messages, participantsByUserId, peerLabelFromUid]);

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);

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
      const msgMs = messageTimestampMs(msg as Record<string, unknown>) || Date.now();
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
      if (toMark.length > 0) {
        const batch = writeBatch(firestore);
        for (const m of toMark) {
          batch.update(doc(firestore, "companies", companyId, "chat", m.id), { read: true });
        }
        await batch.commit().catch(() => {});
      }
    }

    const fromOthers = filteredMessages.filter((m) => m.senderId !== user.uid).slice(-80);
    if (fromOthers.length > 0) {
      const batch = writeBatch(firestore);
      let pending = 0;
      for (const m of fromOthers) {
        const key = `readAtBy.${user.uid}`;
        const existing = (m.readAtBy ?? {})[user.uid];
        if (existing != null) continue;
        batch.update(doc(firestore, "companies", companyId, "chat", m.id), {
          [key]: serverTimestamp(),
        });
        pending += 1;
        if (pending >= 400) break;
      }
      if (pending > 0) await batch.commit().catch(() => {});
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

  const mobileFull = isMobile || fullScreenMobile;
  const [mobileViewportHeight, setMobileViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!mobileFull) {
      setMobileViewportHeight(null);
      return;
    }
    const sync = () => {
      const vv = window.visualViewport;
      setMobileViewportHeight(Math.floor(vv?.height ?? window.innerHeight));
    };
    sync();
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("orientationchange", sync);
    window.addEventListener("resize", sync);
    return () => {
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("orientationchange", sync);
      window.removeEventListener("resize", sync);
    };
  }, [mobileFull]);

  useEffect(() => {
    if (mobileFull && !mobileShowThread) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void markConversationRead();
  }, [
    activeConversationId,
    filteredMessages.length,
    markConversationRead,
    mobileFull,
    mobileShowThread,
  ]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const [showNewBelow, setShowNewBelow] = useState(false);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setShowNewBelow(false);
    } else if (filteredMessages.length > 0) {
      setShowNewBelow(true);
    }
  }, [filteredMessages.length, activeConversationId]);

  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const activeConvMeta = conversations.find((c) => c.id === activeConversationId);

  const notifyRecipients = async (params: {
    recipientUserIds?: string[];
    hasAttachment: boolean;
    preview: string;
    groupTitle?: string;
    companyBroadcast?: boolean;
  }) => {
    if (!user) return;
    if (!params.companyBroadcast && !params.recipientUserIds?.length) return;
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
          recipientUserIds: params.recipientUserIds ?? [],
          senderName: buildSenderNameFromProfile(profile) || "RAJMONDATA",
          senderRole: mode === "employee" ? "employee" : "admin",
          previewText: params.preview,
          conversationId: activeConversationId,
          hasAttachment: params.hasAttachment,
          groupTitle: params.groupTitle,
          companyBroadcast: Boolean(params.companyBroadcast),
        }),
      });
    } catch {
      /* ignore */
    }
  };

  const createDmChat = (authUserId: string, _label: string) => {
    if (!user?.uid) return;
    const dmId = buildDirectConversationId(user.uid, authUserId);
    setActiveConversationId(dmId);
    if (isMobile || fullScreenMobile) setMobileShowThread(true);
    setNewChatOpen(false);
    void markConversationRead();
  };

  const createGroupChat = async (name: string, memberAuthUserIds: string[]) => {
    if (!firestore || !companyId || !user?.uid || !canManageGroups) return;
    setCreatingGroup(true);
    try {
      const id = newGroupConversationId();
      const participantIds = [...new Set([user.uid, ...memberAuthUserIds])];
      await setDoc(doc(firestore, "companies", companyId, "chatConversations", id), {
        id,
        companyId,
        type: "group",
        name,
        participantIds,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setActiveConversationId(id);
      if (isMobile || fullScreenMobile) setMobileShowThread(true);
      setNewChatOpen(false);
    } finally {
      setCreatingGroup(false);
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
      const groupDoc = groupById.get(activeConversationId);
      const peerUid = activeConvMeta?.peerUserId ?? null;
      let participantIds: string[] = [user.uid];
      if (isCompany) {
        participantIds = [user.uid];
      } else if (groupDoc?.participantIds?.length) {
        participantIds = [...new Set(groupDoc.participantIds)];
      } else if (peerUid) {
        participantIds = directMessageParticipantIds(user.uid, peerUid);
      }
      const dmRecipient = !isCompany && !groupDoc && peerUid ? peerUid : null;

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

      const orgRole = String(profile?.role ?? (senderRole === "employee" ? "employee" : "admin")).trim();
      await setDoc(msgRef, {
        companyId,
        organizationId: companyId,
        senderId: user.uid,
        senderUserId: user.uid,
        senderRole,
        senderName,
        senderPhotoURL,
        employeeId: employeeIdField || "",
        text: text || (attachments.length ? "📎 Příloha" : ""),
        read: false,
        conversationId: activeConversationId,
        participantIds,
        recipientUserId: dmRecipient,
        attachments,
        createdAt: serverTimestamp(),
        ...buildMessageTimestampClientFields(),
        ...buildMessageAuthorPersistFields({
          userId: user.uid,
          authorName: senderName,
          authorRole: orgRole,
        }),
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
        void notifyRecipients({
          companyBroadcast: true,
          hasAttachment: attachments.length > 0,
          preview: text || "Nová zpráva",
        });
      } else if (groupDoc) {
        void notifyRecipients({
          recipientUserIds: participantIds.filter((uid) => uid !== user.uid),
          hasAttachment: attachments.length > 0,
          preview: text,
          groupTitle: String(groupDoc.name ?? "Skupinový chat"),
        });
      } else if (dmRecipient) {
        void notifyRecipients({
          recipientUserIds: [dmRecipient],
          hasAttachment: attachments.length > 0,
          preview: text,
        });
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
    fileName: string;
    fileSize: number;
    isVideo: boolean;
  } | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignProgressOpen, setAssignProgressOpen] = useState(false);
  const [assignPhase, setAssignPhase] = useState<AssignProgressPhase>("idle");
  const [assignProgressPct, setAssignProgressPct] = useState<number | null>(null);
  const [assignResult, setAssignResult] = useState<{
    jobLabel: string;
    jobId: string;
    folderName?: string | null;
  } | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const lastAssignJobRef = useRef<{ jobId: string; jobLabel: string } | null>(null);
  const assignFileMetaRef = useRef({
    fileName: "",
    fileSize: 0,
    isVideo: false,
  });

  const openAssignForAttachment = (
    messageId: string,
    attachmentIds: string[],
    senderLabel: string,
    att: ChatAttachmentMeta
  ) => {
    assignFileMetaRef.current = {
      fileName: att.fileName,
      fileSize: att.size,
      isVideo: att.mimeType.startsWith("video/"),
    };
    setAssignTarget({
      messageId,
      attachmentIds,
      senderLabel,
      fileName: att.fileName,
      fileSize: att.size,
      isVideo: att.mimeType.startsWith("video/"),
    });
    setAssignOpen(true);
  };

  const runAssign = async (jobId: string, jobLabel: string) => {
    if (!assignTarget && !lastAssignJobRef.current) return;
    const target = assignTarget;
    if (!target || !user) return;
    lastAssignJobRef.current = { jobId, jobLabel };
    setAssignOpen(false);
    setAssignProgressOpen(true);
    setAssignPhase("prepare");
    setAssignProgressPct(8);
    setAssignError(null);
    setAssigning(true);
    const tick1 = window.setTimeout(() => {
      setAssignPhase("upload");
      setAssignProgressPct(35);
    }, 350);
    const tick2 = window.setTimeout(() => setAssignProgressPct(62), 900);
    const tick3 = window.setTimeout(() => {
      setAssignPhase("save");
      setAssignProgressPct(88);
    }, 1500);
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
        console.error("[chat assign-media]", j.error);
        setAssignPhase("error");
        setAssignError(typeof j.error === "string" ? j.error : null);
        return;
      }
      setAssignProgressPct(100);
      setAssignPhase("success");
      setAssignResult({
        jobLabel,
        jobId,
        folderName: j.folder?.folderName ?? null,
      });
      setAssignTarget(null);
    } catch (e) {
      console.error("[chat assign-media]", e);
      setAssignPhase("error");
      setAssignError(null);
    } finally {
      window.clearTimeout(tick1);
      window.clearTimeout(tick2);
      window.clearTimeout(tick3);
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

  const isActiveGroup =
    isGroupConversationId(activeConversationId) || groupById.has(activeConversationId);

  const openConversation = (id: string) => {
    setActiveConversationId(id);
    if (mobileFull) setMobileShowThread(true);
    void markConversationRead();
  };

  const sidebar = (
    <div className="flex flex-col border-r border-border min-h-0 flex-1">
      <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0">
        <span className="font-semibold text-sm flex-1 truncate">{title}</span>
        {!readOnly ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1 px-2"
            onClick={() => setNewChatOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="sr-only sm:not-sr-only sm:inline">Nový chat</span>
          </Button>
        ) : null}
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y text-sm [-webkit-overflow-scrolling:touch]">
        {conversations.map((c) => {
          const prev = lastPreviewByConv.get(c.id);
          const unread = unreadByConv.get(c.id) ?? 0;
          const initials = c.label.slice(0, 2).toUpperCase();
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
                  <Avatar className="h-9 w-9 shrink-0">
                    {c.photo ? <AvatarImage src={c.photo} /> : null}
                    <AvatarFallback className="text-[10px]">
                      {c.isGroup ? <Users className="h-4 w-4" /> : initials}
                    </AvatarFallback>
                  </Avatar>
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
                    {formatChatTimestampDisplay(prev.createdAt)}
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
    <div className="flex flex-col flex-1 min-h-0 w-full h-full overflow-hidden">
      <div className="border-b px-3 py-1.5 sm:py-2 flex items-center gap-2 shrink-0 bg-background">
        {mobileFull ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setMobileShowThread(false)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold truncate">
            {activeConvMeta?.label ?? "Chat"}
          </h2>
          {isActiveGroup ? (
            <p className="text-[11px] text-muted-foreground truncate">Skupinový chat</p>
          ) : activeConversationId === COMPANY_CHAT_CONVERSATION_ID ? (
            <p className="text-[11px] text-muted-foreground truncate">Firemní konverzace</p>
          ) : mobileFull ? (
            <p className="text-[11px] text-muted-foreground truncate">Soukromý chat</p>
          ) : null}
        </div>
        {!mobileFull ? (
          <span className="text-xs text-muted-foreground truncate max-w-[40%]">
            {displayName}
          </span>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="m-3">
          <AlertTitle>Zprávy nelze načíst</AlertTitle>
          <AlertDescription>{(error as Error)?.message || "Chyba oprávnění."}</AlertDescription>
        </Alert>
      ) : null}

      <div
        ref={messagesScrollRef}
        className="relative flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y px-3 py-3 space-y-3 [-webkit-overflow-scrolling:touch]"
      >
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredMessages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">Zatím žádné zprávy.</p>
        ) : (
          (() => {
            let lastDayLabel: string | null = null;
            return filteredMessages.map((m) => {
            const dayLabel = formatChatDaySeparator(
              messageTimestampFromRecord(m as Record<string, unknown>)
            );
            const showDay = Boolean(dayLabel && dayLabel !== lastDayLabel);
            if (showDay && dayLabel) lastDayLabel = dayLabel;
            const mine = Boolean(user?.uid && m.senderId === user.uid);
            const sender = resolveChatSenderDisplay(m, senderContext);
            const senderLabel = sender.name;
            const { photo: senderPhoto } = sender;
            const readReceiptLine = mine
              ? buildReadReceiptLine(m, {
                  conversationId: activeConversationId,
                  peerUserId: activeConvMeta?.peerUserId,
                  participantIds:
                    activeConvMeta?.participantIds ??
                    groupById.get(activeConversationId)?.participantIds ??
                    (m.participantIds?.length ? m.participantIds : undefined),
                  myUserId: user?.uid,
                  mode,
                })
              : null;
            return (
              <React.Fragment key={m.id}>
                {showDay && dayLabel ? (
                  <div className="sticky top-0 z-[1] flex justify-center py-1">
                    <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] text-muted-foreground">
                      {dayLabel}
                    </span>
                  </div>
                ) : null}
              <div className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}>
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
                  <MessageAuthorMeta
                    mine={mine}
                    sender={sender}
                    message={m}
                    readReceiptLine={readReceiptLine}
                  />
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
                            className="max-h-48 max-lg:max-h-[min(50dvh,280px)] w-full rounded-md border object-contain"
                          />
                        </a>
                      ) : att.mimeType.startsWith("video/") ? (
                        <video
                          controls
                          className="max-h-48 max-lg:max-h-[min(50dvh,280px)] max-w-full rounded-md object-contain"
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
                      {att.linkedJobId ? (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <Badge variant="secondary" className="text-[10px] h-5">
                            Přiřazeno k zakázce
                          </Badge>
                          {jobsAccess.canRead ? (
                            <Link
                              href={`/portal/jobs/${encodeURIComponent(att.linkedJobId)}`}
                              className="text-[11px] underline font-medium"
                            >
                              {att.linkedJobName ?? "Otevřít zakázku"}
                            </Link>
                          ) : null}
                        </div>
                      ) : jobsAccess.canWrite ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() =>
                            openAssignForAttachment(m.id, [att.id], senderLabel, att)
                          }
                        >
                          Přiřadit k zakázce
                        </Button>
                      ) : null}
                      {att.mimeType.startsWith("image/") ||
                      att.mimeType.includes("pdf") ? (
                        <ChatAttachmentDocumentPanel
                          companyId={companyId}
                          messageId={m.id}
                          attachment={att}
                          conversationId={activeConversationId}
                        />
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
                        const first = (m.attachments ?? [])[0];
                        if (!first) return;
                        openAssignForAttachment(
                          m.id,
                          (m.attachments ?? []).map((a) => a.id),
                          senderLabel,
                          first
                        );
                      }}
                    >
                      Přiřadit všechny k zakázce
                    </Button>
                  ) : null}
                </div>
              </div>
              </React.Fragment>
            );
          });
          })()
        )}
        {showNewBelow ? (
          <div className="sticky bottom-2 flex justify-center pointer-events-none">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="pointer-events-auto shadow-md h-8 text-xs"
              onClick={() => {
                bottomRef.current?.scrollIntoView({ behavior: "smooth" });
                setShowNewBelow(false);
              }}
            >
              Nové zprávy ↓
            </Button>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {!readOnly ? (
        <div className="border-t p-2 space-y-2 shrink-0 bg-background pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]">
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
    </div>
  );

  return (
    <>
      <Card
        className={cn(
          "flex flex-col overflow-hidden min-h-0",
          mobileFull
            ? "flex-1 min-h-0 h-full max-h-[100dvh] rounded-none border-0 shadow-none"
            : "min-h-[420px] max-h-[calc(100vh-120px)] md:max-h-[calc(100vh-140px)]"
        )}
        style={
          mobileFull && mobileViewportHeight
            ? { height: mobileViewportHeight, maxHeight: mobileViewportHeight }
            : undefined
        }
      >
        <div className="flex flex-1 min-h-0 w-full overflow-hidden">
          {mobileFull ? (
            mobileShowThread ? (
              <div className="flex flex-col flex-1 min-h-0 w-full">{thread}</div>
            ) : (
              <div className="flex flex-col flex-1 min-h-0 w-full border-r-0">{sidebar}</div>
            )
          ) : (
            <>
              <div className="w-56 lg:w-64 shrink-0 flex flex-col min-h-0">{sidebar}</div>
              <div className="flex flex-col flex-1 min-h-0">{thread}</div>
            </>
          )}
        </div>
      </Card>
      <ChatNewConversationDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        employees={chatContactOptions}
        canCreateGroup={canManageGroups}
        onCreateDm={createDmChat}
        onCreateGroup={createGroupChat}
        creating={creatingGroup}
      />
      <ChatAssignJobDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        companyId={companyId}
        onAssign={runAssign}
        assigning={assigning}
      />
      <ChatAssignProgressDialog
        open={assignProgressOpen}
        jobLabel={
          assignResult?.jobLabel ?? lastAssignJobRef.current?.jobLabel ?? "Zakázka"
        }
        fileLabel={
          (assignTarget?.fileName ?? assignFileMetaRef.current.fileName) || "Soubor"
        }
        fileSizeBytes={assignTarget?.fileSize ?? assignFileMetaRef.current.fileSize}
        isVideo={assignTarget?.isVideo ?? assignFileMetaRef.current.isVideo}
        phase={assignPhase}
        progressPct={assignProgressPct}
        folderName={assignResult?.folderName}
        jobId={assignResult?.jobId ?? lastAssignJobRef.current?.jobId ?? null}
        errorMessage={assignError}
        onRetry={() => {
          const job = lastAssignJobRef.current;
          if (job && assignTarget) void runAssign(job.jobId, job.jobLabel);
        }}
        onDone={() => {
          setAssignProgressOpen(false);
          setAssignPhase("idle");
          setAssignProgressPct(null);
          setAssignResult(null);
          setAssignError(null);
          lastAssignJobRef.current = null;
        }}
      />
    </>
  );
}
