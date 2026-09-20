"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUser, useCompany } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { EmailConnectWizard } from "@/components/portal/email-connect-wizard";
import type { EmailMessageWorkflowView } from "@/lib/email-mailbox/types";
import { EMAIL_PORTAL_FOLDERS } from "@/lib/email-mailbox/intelligence-types";
import { parseEmailApiResponse } from "@/lib/email-mailbox/client-fetch";
import {
  EmailPortalDetailPanel,
  type AssignableEmployee,
  type EmailDetailModel,
  type ThreadMessage,
  type TimelineEvent,
} from "@/components/portal/email-portal-detail-panel";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Mail, Plus, Search } from "lucide-react";
import { EmailMessageListRow } from "@/components/portal/email-message-list-row";
import { folderTheme } from "@/lib/email-mailbox/email-portal-folder-theme";
import { userVisibleAttachments } from "@/lib/email-mailbox/attachment-meta";
import {
  EmailReplyAttachments,
  type LocalReplyFile,
} from "@/components/portal/email-reply-attachments";
import type { JobDocumentEmailAttachmentRef } from "@/lib/job-document-email-attachments";
import { EMAIL_ACCOUNT_ALL_MAILBOXES } from "@/lib/email-mailbox/account-default";
import { EmailAssignMessageJobDialog } from "@/components/portal/email-assign-message-job-dialog";

type AccountRow = {
  id: string;
  email: string;
  provider: string;
  status: string;
  lastSyncAt: string | null;
  isDefault?: boolean;
  disconnected?: boolean;
};

type MsgRow = {
  id: string;
  from: string;
  subject: string;
  receivedAt: string | null;
  isRead?: boolean;
  needsReply?: boolean;
  staleNeedsReply?: boolean;
  customerName?: string | null;
  jobId?: string | null;
  jobLabel?: string | null;
  emailAccountId: string;
  mailboxEmail?: string | null;
  aiPriority?: string | null;
  aiCategory?: string | null;
  attachmentCount?: number;
  aiSummary?: string | null;
  aiReviewPending?: boolean;
  resolved?: boolean;
  workflowState?: string | null;
};

type RajmondataAttachRef = JobDocumentEmailAttachmentRef & { jobId: string };

type MsgDetail = EmailDetailModel & {
  to?: string[];
  inquiryDraft?: Record<string, unknown> | null;
};

type MobilePane = "folders" | "list" | "detail";

const EMAIL_LIST_PAGE_SIZE = 50;

const ONBOARDING_BULLETS = [
  "příchozí a odeslané e-maily v RAJMONDATA",
  "přiřazení e-mailu k zákazníkovi",
  "přiřazení e-mailu k zakázce",
  "AI třídění komunikace",
  "AI návrhy odpovědí",
  "upozornění na nezodpovězené zprávy",
  "možnost vytvářet z e-mailu úkol",
  "hlídání důležitých termínů a požadavků",
  "vyhledávání v komunikaci",
];

export function EmailPortalPage() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const access = usePortalModuleAccess("emails");

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(searchParams.get("setup") === "1");
  const initialView = (searchParams.get("view") ?? "inbox") as EmailMessageWorkflowView;
  const [folder, setFolder] = useState<EmailMessageWorkflowView>(
    EMAIL_PORTAL_FOLDERS.some((f) => f.id === initialView) ? initialView : "inbox"
  );
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MsgDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [replyText, setReplyText] = useState("");
  const [assignJobId, setAssignJobId] = useState("");
  const [emailJobDialogOpen, setEmailJobDialogOpen] = useState(false);
  const [assignCustomerId, setAssignCustomerId] = useState("");
  const [shareWithJob, setShareWithJob] = useState(false);
  /** Prázdné = použij výchozí účet po načtení seznamu účtů. */
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "updated">("idle");
  const [lastSyncLabel, setLastSyncLabel] = useState<string | null>(null);
  const mailboxSelectionInitialized = useRef(false);
  const [composeFromAccountId, setComposeFromAccountId] = useState<string>("");
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const [employees, setEmployees] = useState<AssignableEmployee[]>([]);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [assignNote, setAssignNote] = useState("");
  const [assignDue, setAssignDue] = useState("");
  const [replyLocalFiles, setReplyLocalFiles] = useState<LocalReplyFile[]>([]);
  const [forwardAttachmentIds, setForwardAttachmentIds] = useState<string[]>([]);
  const [rajmondataRefs, setRajmondataRefs] = useState<RajmondataAttachRef[]>([]);
  const [composeForwardMode, setComposeForwardMode] = useState(false);
  const [visibleListCount, setVisibleListCount] = useState(EMAIL_LIST_PAGE_SIZE);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listScrollTopRef = useRef(0);

  const connectedAccounts = useMemo(
    () => accounts.filter((a) => !a.disconnected && a.status !== "disconnected"),
    [accounts]
  );

  const defaultAccountId =
    connectedAccounts.find((a) => a.isDefault)?.id ?? connectedAccounts[0]?.id ?? "";

  const activeAccountId =
    selectedAccountId === EMAIL_ACCOUNT_ALL_MAILBOXES
      ? EMAIL_ACCOUNT_ALL_MAILBOXES
      : selectedAccountId || defaultAccountId || "";

  const composeAccountId = composeFromAccountId || defaultAccountId;

  const getToken = useCallback(async () => {
    if (!user) throw new Error("Nepřihlášen");
    return user.getIdToken();
  }, [user]);

  const loadAccounts = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    setLoadingAccounts(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/company/email-mailbox/accounts?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse<{ accounts?: AccountRow[] }>(res);
      if (data.ok) {
        const list = data.accounts ?? [];
        setAccounts(list);
        const connected = list.filter((a) => !a.disconnected && a.status !== "disconnected");
        const fromUrl = searchParams.get("account");
        setSelectedAccountId((prev) => {
          if (fromUrl && list.some((a) => a.id === fromUrl)) {
            mailboxSelectionInitialized.current = true;
            return fromUrl;
          }
          if (
            mailboxSelectionInitialized.current &&
            prev &&
            (prev === EMAIL_ACCOUNT_ALL_MAILBOXES || list.some((a) => a.id === prev))
          ) {
            return prev;
          }
          mailboxSelectionInitialized.current = true;
          const def = connected.find((a) => a.isDefault)?.id ?? connected[0]?.id ?? "";
          return def;
        });
        const def = connected.find((a) => a.isDefault)?.id ?? connected[0]?.id ?? "";
        setComposeFromAccountId((p) => p || def);
      }
      else if (data.message || data.error) {
        toast({ variant: "destructive", title: "Účty e-mailu", description: data.message ?? data.error });
      }
    } finally {
      setLoadingAccounts(false);
    }
  }, [user, companyId, access.canRead, getToken, toast, searchParams]);

  const loadMessages = useCallback(async () => {
    if (!user || !companyId || !access.canRead || accounts.length === 0 || !activeAccountId) return;
    setLoadingList(true);
    try {
      const token = await getToken();
      const accountQuery =
        activeAccountId === EMAIL_ACCOUNT_ALL_MAILBOXES
          ? `accountId=${encodeURIComponent(EMAIL_ACCOUNT_ALL_MAILBOXES)}`
          : activeAccountId
            ? `accountId=${encodeURIComponent(activeAccountId)}`
            : "";
      const res = await fetch(
        `/api/company/email-mailbox/messages?companyId=${encodeURIComponent(companyId)}&view=${folder}&${accountQuery}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse<{ messages?: MsgRow[] }>(res);
      if (data.ok) setMessages(data.messages ?? []);
    } finally {
      setLoadingList(false);
    }
  }, [user, companyId, folder, access.canRead, accounts.length, activeAccountId, getToken]);

  const loadFolderCounts = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/company/email-mailbox/folder-stats?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse<{ counts?: Record<string, number> }>(res);
      if (data.ok) setFolderCounts(data.counts ?? {});
    } catch {
      /* ignore */
    }
  }, [user, companyId, access.canRead, getToken]);

  const loadEmployees = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/company/email-mailbox/assignable-employees?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse<{ employees?: AssignableEmployee[] }>(res);
      if (data.ok) setEmployees(data.employees ?? []);
    } catch {
      /* ignore */
    }
  }, [user, companyId, access.canRead, getToken]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadMessages();
    void loadFolderCounts();
  }, [loadMessages, loadFolderCounts]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  const runIncrementalSync = useCallback(
    async (accountId: string) => {
      if (!companyId || !access.canWrite || !accountId || accountId === EMAIL_ACCOUNT_ALL_MAILBOXES) {
        return;
      }
      setSyncStatus("syncing");
      try {
        const token = await getToken();
        let hasMore = true;
        for (let round = 0; round < 3 && hasMore; round++) {
          const res = await fetch(`/api/company/email-mailbox/accounts/${accountId}/sync`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, maxMessages: 25, batchSize: 25 }),
          });
          const data = await parseEmailApiResponse<{ hasMore?: boolean }>(res);
          if (!data.ok) break;
          hasMore = Boolean(data.hasMore);
        }
        await loadMessages();
        await loadFolderCounts();
        setSyncStatus("updated");
        setLastSyncLabel(
          new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })
        );
        window.setTimeout(() => setSyncStatus("idle"), 8000);
      } catch {
        setSyncStatus("idle");
      }
    },
    [companyId, access.canWrite, getToken, loadMessages, loadFolderCounts]
  );

  useEffect(() => {
    if (!activeAccountId || activeAccountId === EMAIL_ACCOUNT_ALL_MAILBOXES) return;
    void runIncrementalSync(activeAccountId);
  }, [activeAccountId, runIncrementalSync]);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    setVisibleListCount(EMAIL_LIST_PAGE_SIZE);
    if (listScrollRef.current) {
      listScrollRef.current.scrollTop = 0;
    }
  }, [folder, activeAccountId]);

  useEffect(() => {
    setVisibleListCount(EMAIL_LIST_PAGE_SIZE);
    if (listScrollRef.current) {
      listScrollRef.current.scrollTop = 0;
    }
  }, [search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? messages.filter(
          (m) =>
            m.subject.toLowerCase().includes(q) ||
            m.from.toLowerCase().includes(q) ||
            (m.customerName ?? "").toLowerCase().includes(q) ||
            (m.aiSummary ?? "").toLowerCase().includes(q)
        )
      : messages;
    return [...base].sort((a, b) => {
      const ta = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const tb = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      return tb - ta;
    });
  }, [messages, search]);

  const listSlice = useMemo(
    () => filtered.slice(0, visibleListCount),
    [filtered, visibleListCount]
  );

  const hasMoreListItems = filtered.length > visibleListCount;

  const onListScroll = useCallback(() => {
    const el = listScrollRef.current;
    if (!el) return;
    listScrollTopRef.current = el.scrollTop;
    if (!hasMoreListItems) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 96) {
      setVisibleListCount((c) => Math.min(filtered.length, c + EMAIL_LIST_PAGE_SIZE));
    }
  }, [filtered.length, hasMoreListItems]);

  const loadMoreList = useCallback(() => {
    setVisibleListCount((c) => Math.min(filtered.length, c + EMAIL_LIST_PAGE_SIZE));
  }, [filtered.length]);

  useLayoutEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    el.scrollTop = listScrollTopRef.current;
  }, [selectedId, detail?.id]);

  const messageIdFromUrl = searchParams.get("messageId");

  const loadDetail = useCallback(
    async (id: string) => {
      if (!user || !companyId) return;
      setSelectedId(id);
      setMobilePane("detail");
      const token = await getToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages/${id}?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse<{ message?: MsgDetail }>(res);
      if (data.ok && data.message) {
        setDetail(data.message);
        setReplyText(String(data.message?.aiDraftReply ?? ""));
        setAssignJobId(String(data.message?.jobId ?? data.message?.suggestedJobId ?? ""));
        setAssignCustomerId(String(data.message?.customerId ?? data.message?.suggestedCustomerId ?? ""));
        const [threadRes, timelineRes] = await Promise.all([
          fetch(
            `/api/company/email-mailbox/messages/${id}/thread?companyId=${encodeURIComponent(companyId)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
          fetch(
            `/api/company/email-mailbox/messages/${id}/timeline?companyId=${encodeURIComponent(companyId)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
        ]);
        const threadData = await threadRes.json();
        const timelineData = await timelineRes.json();
        setThread(threadData.ok ? (threadData.thread ?? []) : []);
        setTimeline(timelineData.ok ? (timelineData.events ?? []) : []);
        if (access.canWrite) {
          await fetch(`/api/company/email-mailbox/messages/${id}/patch`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, isRead: true }),
          });
        }
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isRead: true } : m)));
      }
    },
    [user, companyId, getToken, access.canWrite]
  );

  useEffect(() => {
    if (loadingList || loadingAccounts) return;
    if (filtered.length === 0) return;

    if (messageIdFromUrl && filtered.some((m) => m.id === messageIdFromUrl)) {
      if (selectedId !== messageIdFromUrl) void loadDetail(messageIdFromUrl);
      return;
    }

    if (selectedId && filtered.some((m) => m.id === selectedId)) return;

    const isDesktop =
      typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
    if (isDesktop && !messageIdFromUrl) {
      void loadDetail(filtered[0]!.id);
    }
  }, [
    loadingList,
    loadingAccounts,
    filtered,
    messageIdFromUrl,
    selectedId,
    folder,
    activeAccountId,
    loadDetail,
  ]);

  async function syncNow() {
    if (!companyId) return;
    setBusy(true);
    toast({ title: "Synchronizuji…", description: "Stahuji nové zprávy z IMAP." });
    try {
      const token = await getToken();
      if (activeAccountId === EMAIL_ACCOUNT_ALL_MAILBOXES) {
        const res = await fetch("/api/company/email-mailbox/accounts/sync-all", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, maxMessages: 100 }),
        });
        const data = await parseEmailApiResponse(res);
        if (!data.ok) {
          toast({ variant: "destructive", title: "Synchronizace selhala", description: data.message ?? data.error });
          return;
        }
        toast({ title: "Synchronizace dokončena", description: data.message });
      } else if (activeAccountId) {
        const res = await fetch(`/api/company/email-mailbox/accounts/${activeAccountId}/sync`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, maxMessages: 100 }),
        });
        const data = await parseEmailApiResponse<{ imported?: number }>(res);
        if (!data.ok) {
          toast({ variant: "destructive", title: "Synchronizace selhala", description: data.message ?? data.error });
          return;
        }
        toast({
          title: "Synchronizace dokončena",
          description: data.message ?? `Synchronizováno – ${data.imported ?? 0} nových zpráv.`,
        });
      }
      await loadMessages();
      await loadFolderCounts();
      await loadAccounts();
      setSyncStatus("updated");
      setLastSyncLabel(
        new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })
      );
    } finally {
      setBusy(false);
    }
  }

  const activeMailboxEmail =
    connectedAccounts.find((a) => a.id === activeAccountId)?.email ??
    (activeAccountId === EMAIL_ACCOUNT_ALL_MAILBOXES ? "Všechny schránky" : "");

  async function aiDraft(tone?: "default" | "shorter" | "formal" | "friendly") {
    if (!selectedId || !companyId) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages/${selectedId}/ai-draft?companyId=${encodeURIComponent(companyId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ tone: tone ?? "default" }),
        }
      );
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "AI návrh selhal", description: data.error });
        return;
      }
      setReplyText(String(data.draft ?? ""));
    } finally {
      setBusy(false);
    }
  }

  async function sendMail(opts: { reply?: boolean; forward?: boolean }) {
    if (!companyId || !access.canWrite) return;
    const sendAccountId = opts.reply && detail?.emailAccountId
      ? detail.emailAccountId
      : composeAccountId;
    if (!sendAccountId) {
      toast({ variant: "destructive", title: "Vyberte odesílací schránku" });
      return;
    }
    const to = opts.reply && detail && !opts.forward
      ? [detail.from.replace(/.*<([^>]+)>.*/, "$1").trim() || detail.from]
      : composeTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    let subject = opts.reply && detail && !opts.forward ? detail.subject : composeSubject;
    if (opts.forward && !subject.toLowerCase().startsWith("fwd:")) {
      subject = `Fwd: ${subject}`;
    }
    const text = opts.reply && !opts.forward ? replyText : composeBody;
    if (!to.length || !text.trim()) return;
    setBusy(true);
    try {
      const token = await getToken();
      const useMultipart =
        replyLocalFiles.length > 0 ||
        forwardAttachmentIds.length > 0 ||
        rajmondataRefs.length > 0;

      let res: Response;
      if (useMultipart) {
        const form = new FormData();
        form.set("companyId", companyId);
        form.set("accountId", sendAccountId);
        form.set("to", JSON.stringify(to));
        form.set("subject", subject);
        form.set("textBody", text);
        if (opts.reply && detail?.id) form.set("replyToMessageId", detail.id);
        if (opts.forward && detail?.id) {
          form.set("forwardFromMessageId", detail.id);
          form.set("forwardAttachmentIds", JSON.stringify(forwardAttachmentIds));
        } else if (forwardAttachmentIds.length && detail?.id) {
          form.set("forwardFromMessageId", detail.id);
          form.set("forwardAttachmentIds", JSON.stringify(forwardAttachmentIds));
        }
        const rajJob = rajmondataRefs[0]?.jobId ?? detail?.jobId ?? "";
        if (rajJob && rajmondataRefs.length) {
          form.set("rajmondataJobId", rajJob);
          form.set(
            "rajmondataAttachmentRefs",
            JSON.stringify(
              rajmondataRefs.map(({ jobId: _j, ...r }) => r)
            )
          );
        }
        for (const row of replyLocalFiles) {
          form.append("files", row.file);
        }
        res = await fetch("/api/company/email-mailbox/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
      } else {
        res = await fetch("/api/company/email-mailbox/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            accountId: sendAccountId,
            to,
            subject,
            textBody: text,
            replyToMessageId: opts.reply && !opts.forward ? detail?.id : undefined,
          }),
        });
      }
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Odeslání selhalo", description: data.error });
        return;
      }
      toast({ title: "E-mail odeslán" });
      setComposeOpen(false);
      setComposeForwardMode(false);
      setReplyLocalFiles([]);
      setRajmondataRefs([]);
      await loadMessages();
    } finally {
      setBusy(false);
    }
  }

  async function markResolved() {
    if (!selectedId || !companyId) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fetch(
        `/api/company/email-mailbox/messages/${selectedId}/workflow?companyId=${encodeURIComponent(companyId)}`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, resolved: true }),
        }
      );
      toast({ title: "Vyřešeno" });
      await loadMessages();
      await loadFolderCounts();
      setSelectedId(null);
      setDetail(null);
      setMobilePane("list");
    } finally {
      setBusy(false);
    }
  }

  async function setReminder(preset: string) {
    if (!selectedId || !companyId) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fetch(
        `/api/company/email-mailbox/messages/${selectedId}/reminder?companyId=${encodeURIComponent(companyId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, preset }),
        }
      );
      toast({ title: "Připomenutí nastaveno" });
      await loadDetail(selectedId);
    } finally {
      setBusy(false);
    }
  }

  async function assignEmployeeInternal() {
    if (!selectedId || !companyId || !assigneeUserId) return;
    setBusy(true);
    try {
      const token = await getToken();
      const emp = employees.find((e) => e.userId === assigneeUserId);
      await fetch(
        `/api/company/email-mailbox/messages/${selectedId}/assign-employee?companyId=${encodeURIComponent(companyId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            assigneeUserId,
            assigneeEmployeeId: emp?.employeeId ?? null,
            note: assignNote || null,
            dueAt: assignDue ? new Date(assignDue).toISOString() : null,
          }),
        }
      );
      toast({ title: "Předáno pracovníkovi" });
      await loadDetail(selectedId);
      await loadFolderCounts();
    } finally {
      setBusy(false);
    }
  }

  async function applySuggestedJob() {
    if (!detail?.suggestedJobId || !selectedId || !companyId) return;
    setAssignJobId(detail.suggestedJobId);
    setAssignCustomerId(detail.suggestedCustomerId ?? assignCustomerId);
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/company/email-mailbox/messages/${selectedId}/assign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          jobId: detail.suggestedJobId,
          customerId: detail.suggestedCustomerId ?? null,
        }),
      });
      const data = await res.json();
      toast({
        title: "E-mail přiřazen k zakázce",
        description: data.jobLabel ?? detail?.suggestedJobLabel ?? detail.suggestedJobId ?? undefined,
      });
      await loadDetail(selectedId);
    } finally {
      setBusy(false);
    }
  }

  async function assignEmailToJob(jobId: string) {
    if (!selectedId || !companyId) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/company/email-mailbox/messages/${selectedId}/assign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          jobId,
          customerId: assignCustomerId.trim() || detail?.customerId || null,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Přiřazení selhalo", description: data.error });
        return;
      }
      setAssignJobId(jobId);
      toast({
        title: "E-mail přiřazen k zakázce",
        description: data.jobLabel ?? jobId,
      });
      setEmailJobDialogOpen(false);
      await loadDetail(selectedId);
    } finally {
      setBusy(false);
    }
  }

  async function assignLinks() {
    if (!selectedId || !companyId) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/company/email-mailbox/messages/${selectedId}/assign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          jobId: assignJobId.trim() || null,
          customerId: assignCustomerId.trim() || null,
          shareWithJob: shareWithJob && Boolean(assignJobId.trim()),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Přiřazení selhalo", description: data.error });
        return;
      }
      toast({
        title: "Přiřazení uloženo",
        description: data.jobLabel ?? (assignJobId.trim() || undefined),
      });
      await loadDetail(selectedId);
    } finally {
      setBusy(false);
    }
  }

  if (!access.canRead) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Nemáte oprávnění k modulu E-mail.</p>
      </div>
    );
  }

  if (loadingAccounts) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Načítám schránku…</p>
      </div>
    );
  }

  if (accounts.length === 0 || (wizardOpen && connectedAccounts.length === 0)) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        {!wizardOpen ? (
          <Card className="border-primary/20">
            <CardHeader>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Mail className="h-6 w-6" />
              </div>
              <CardTitle className="text-2xl">Moje pošta</CardTitle>
              <p className="text-muted-foreground">
                Připojte svůj pracovní e-mail a spravujte vlastní komunikaci se zákazníky přímo u zakázek.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {access.canWrite ? (
                <Button size="lg" className="gap-2" onClick={() => setWizardOpen(true)}>
                  <Plus className="h-4 w-4" /> Připojit e-mailovou schránku
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nemáte oprávnění připojit schránku. Požádejte administrátora o přístup k modulu E-mail.
                </p>
              )}
              <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                {ONBOARDING_BULLETS.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-primary">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Button variant="link" className="px-0" asChild>
                <Link href="/portal/settings">Nastavení → Profil → Můj e-mail</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Připojit schránku</CardTitle>
            </CardHeader>
            <CardContent>
              {companyId && access.canWrite ? (
                <EmailConnectWizard
                  companyId={companyId}
                  getToken={getToken}
                  onConnected={() => {
                    setWizardOpen(false);
                    void loadAccounts();
                  }}
                  onCancel={() => setWizardOpen(false)}
                />
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {connectedAccounts.length === 0 && accounts.length > 0 ? (
        <div className="mx-3 mt-3 shrink-0 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Všechny účty jsou odpojené. Historii zpráv stále vidíte níže. Nový e-mail připojte v{" "}
          <Link href="/portal/settings" className="text-primary underline">
            Profil → Moje e-mailové účty
          </Link>
          .
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <aside
        className={cn(
          "flex w-full shrink-0 flex-col min-h-0 overflow-hidden border-b p-3 lg:w-56 lg:max-h-full lg:border-b-0 lg:border-r",
          mobilePane !== "folders" && "hidden lg:flex"
        )}
      >
        <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Moje schránka
        </p>
        {connectedAccounts.length >= 1 && activeAccountId ? (
          <>
            <Select
              value={activeAccountId}
              onValueChange={(v) => {
                mailboxSelectionInitialized.current = true;
                setSelectedAccountId(v);
              }}
            >
              <SelectTrigger className="mb-1 w-full min-h-[44px] font-medium">
                <SelectValue placeholder="Načítám…" />
              </SelectTrigger>
              <SelectContent>
                {connectedAccounts.length > 1 ? (
                  <SelectItem value={EMAIL_ACCOUNT_ALL_MAILBOXES}>Všechny moje schránky</SelectItem>
                ) : null}
                {connectedAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.email}
                    {a.isDefault ? " (výchozí)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] text-emerald-700">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              Připojeno
            </p>
            {syncStatus === "syncing" ? (
              <p className="mb-2 text-[11px] text-muted-foreground">Synchronizuji nové zprávy…</p>
            ) : syncStatus === "updated" && lastSyncLabel ? (
              <p className="mb-2 text-[11px] text-muted-foreground">Aktualizováno {lastSyncLabel}</p>
            ) : activeMailboxEmail ? (
              <p className="mb-2 truncate text-[11px] text-muted-foreground">{activeMailboxEmail}</p>
            ) : null}
          </>
        ) : connectedAccounts.length >= 1 ? (
          <div className="mb-3 space-y-2">
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <p className="text-[11px] text-muted-foreground">Načítám schránku…</p>
          </div>
        ) : (
          <p className="mb-3 truncate text-sm font-medium text-muted-foreground">—</p>
        )}
        <Button
          className="mb-3 w-full gap-2 min-h-[44px]"
          disabled={!access.canWrite || connectedAccounts.length === 0}
          onClick={() => {
            setComposeFromAccountId(defaultAccountId);
            setComposeOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Nový e-mail
        </Button>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {EMAIL_PORTAL_FOLDERS.map((f) => {
            const count = f.countActive ? folderCounts[f.id] : undefined;
            const theme = folderTheme(f.id as EmailMessageWorkflowView);
            const Icon = theme.icon;
            const active = folder === f.id;
            return (
              <Button
                key={f.id}
                variant="ghost"
                size="sm"
                className={cn(
                  "justify-between gap-2 min-h-[36px] border-l-[3px] border-transparent pl-2",
                  active && theme.activeRowClass
                )}
                onClick={() => {
                  setFolder(f.id);
                  setMobilePane("list");
                }}
              >
                <span className="flex min-w-0 items-center gap-2 truncate text-left">
                  <Icon className={cn("h-4 w-4 shrink-0", theme.accentClass)} />
                  <span className={cn(active && "font-semibold")}>{f.label}</span>
                </span>
                {typeof count === "number" && count > 0 ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0 text-[11px] font-semibold tabular-nums",
                      theme.badgeClass
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </Button>
            );
          })}
        </nav>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-full shrink-0 min-h-[44px]"
          disabled={busy || connectedAccounts.length === 0}
          onClick={() => void syncNow()}
        >
          {activeAccountId === EMAIL_ACCOUNT_ALL_MAILBOXES ? "Sync všechny" : "Synchronizovat"}
        </Button>
        {access.canWrite && connectedAccounts.length > 0 ? (
          <Button variant="link" size="sm" className="mt-2 w-full" asChild>
            <Link href="/portal/settings">+ Další e-mail</Link>
          </Button>
        ) : null}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex shrink-0 gap-2 border-b p-2 lg:hidden">
          <Button size="sm" variant={mobilePane === "folders" ? "secondary" : "outline"} onClick={() => setMobilePane("folders")}>
            Složky
          </Button>
          <Button size="sm" variant={mobilePane === "list" ? "secondary" : "outline"} onClick={() => setMobilePane("list")}>
            Seznam
          </Button>
        </div>
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b lg:w-[min(100%,22rem)] lg:flex-none lg:border-b-0 lg:border-r max-lg:min-h-[40vh]",
            mobilePane === "detail" && "hidden lg:flex",
            mobilePane === "folders" && "hidden lg:flex"
          )}
        >
          <div className="sticky top-0 z-10 shrink-0 border-b bg-background p-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Hledat…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div
            ref={listScrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            onScroll={onListScroll}
          >
            {loadingList ? (
              <div className="p-4 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Ve schránce nejsou žádné zprávy.</p>
            ) : (
              <>
                {listSlice.map((m) => (
                  <EmailMessageListRow
                    key={m.id}
                    message={m}
                    selected={selectedId === m.id}
                    showMailbox={activeAccountId === EMAIL_ACCOUNT_ALL_MAILBOXES}
                    onSelect={() => {
                      if (listScrollRef.current) {
                        listScrollTopRef.current = listScrollRef.current.scrollTop;
                      }
                      void loadDetail(m.id);
                    }}
                  />
                ))}
                {hasMoreListItems ? (
                  <div className="border-t p-2">
                    <Button variant="ghost" size="sm" className="w-full" onClick={loadMoreList}>
                      Načíst další ({filtered.length - visibleListCount} zbývá)
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 sm:p-4 max-lg:min-h-[50vh]",
            mobilePane !== "detail" && "max-lg:hidden"
          )}
        >
          {composeOpen ? (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain max-w-xl">
              <h2 className="font-semibold">Nový e-mail</h2>
              {connectedAccounts.length > 1 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Od:</p>
                  <Select value={composeAccountId} onValueChange={setComposeFromAccountId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {connectedAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Od: {connectedAccounts[0]?.email ?? "—"}</p>
              )}
              <Input placeholder="Komu" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} />
              <Input placeholder="Předmět" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
              <Textarea rows={8} value={composeBody} onChange={(e) => setComposeBody(e.target.value)} />
              {composeForwardMode && detail && companyId ? (
                <EmailReplyAttachments
                  companyId={companyId}
                  jobId={detail.jobId}
                  sourceAttachments={detail.attachments}
                  forwardMode
                  getToken={getToken}
                  localFiles={replyLocalFiles}
                  onLocalFilesChange={setReplyLocalFiles}
                  forwardAttachmentIds={forwardAttachmentIds}
                  onForwardAttachmentIdsChange={setForwardAttachmentIds}
                  rajmondataRefs={rajmondataRefs}
                  onRajmondataRefsChange={setRajmondataRefs}
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void sendMail(composeForwardMode ? { forward: true } : {})}
                >
                  Odeslat
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeForwardMode(false);
                  }}
                >
                  Zrušit
                </Button>
              </div>
            </div>
          ) : !detail ? (
            <p className="text-muted-foreground text-sm">
              {filtered.length > 0
                ? "Vyberte zprávu v seznamu."
                : "Ve schránce nejsou žádné zprávy."}
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <EmailPortalDetailPanel
              detail={detail}
              canWrite={access.canWrite}
              busy={busy}
              replyText={replyText}
              onReplyText={setReplyText}
              assignCustomerId={assignCustomerId}
              assignJobId={assignJobId}
              shareWithJob={shareWithJob}
              onAssignCustomerId={setAssignCustomerId}
              onAssignJobId={setAssignJobId}
              onShareWithJob={setShareWithJob}
              employees={employees}
              assigneeUserId={assigneeUserId}
              onAssigneeUserId={setAssigneeUserId}
              assignNote={assignNote}
              onAssignNote={setAssignNote}
              assignDue={assignDue}
              onAssignDue={setAssignDue}
              thread={thread}
              timeline={timeline}
              onBack={() => {
                setSelectedId(null);
                setDetail(null);
                setMobilePane("list");
              }}
              onAiDraft={(t) => void aiDraft(t)}
              onReply={() => void sendMail({ reply: true })}
              onForward={() => {
                setComposeTo("");
                setComposeSubject(`Fwd: ${detail.subject}`);
                setComposeBody(`\n\n---------- Přeposlaná zpráva ----------\n${detail.textBody ?? ""}`);
                setComposeFromAccountId(detail.emailAccountId || defaultAccountId);
                setForwardAttachmentIds(
                  userVisibleAttachments(detail.attachments).map((a) => a.id)
                );
                setComposeForwardMode(true);
                setComposeOpen(true);
              }}
              onResolve={() => void markResolved()}
              onAssignLinks={() => void assignLinks()}
              onAssignEmailToJob={() => setEmailJobDialogOpen(true)}
              onAssignEmployee={() => void assignEmployeeInternal()}
              onReminder={(p) => void setReminder(p)}
              onApplySuggestedJob={() => void applySuggestedJob()}
              companyId={companyId!}
              getToken={getToken}
              onAttachmentsLinked={() => selectedId && void loadDetail(selectedId)}
              replyLocalFiles={replyLocalFiles}
              onReplyLocalFilesChange={setReplyLocalFiles}
              forwardAttachmentIds={forwardAttachmentIds}
              onForwardAttachmentIdsChange={setForwardAttachmentIds}
              rajmondataRefs={rajmondataRefs}
              onRajmondataRefsChange={setRajmondataRefs}
              forwardMode={composeForwardMode}
            />
            </div>
          )}
        </div>
      </div>
      </div>

      {companyId ? (
        <EmailAssignMessageJobDialog
          open={emailJobDialogOpen}
          onOpenChange={setEmailJobDialogOpen}
          companyId={companyId}
          getToken={getToken}
          busy={busy}
          onConfirm={assignEmailToJob}
        />
      ) : null}
    </div>
  );
}
