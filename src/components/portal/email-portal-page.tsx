"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { priorityEmoji } from "@/lib/email-mailbox/intelligence-types";
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
import { Loader2, Mail, Paperclip, Plus, Search } from "lucide-react";
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
  jobLabel?: string | null;
  emailAccountId: string;
  mailboxEmail?: string | null;
  aiPriority?: string | null;
  aiCategory?: string | null;
  attachmentCount?: number;
};

type RajmondataAttachRef = JobDocumentEmailAttachmentRef & { jobId: string };

type MsgDetail = EmailDetailModel & {
  to?: string[];
  inquiryDraft?: Record<string, unknown> | null;
};

type MobilePane = "folders" | "list" | "detail";

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
  const [selectedAccountId, setSelectedAccountId] = useState<string>(EMAIL_ACCOUNT_ALL_MAILBOXES);
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

  const connectedAccounts = useMemo(
    () => accounts.filter((a) => !a.disconnected && a.status !== "disconnected"),
    [accounts]
  );

  const defaultAccountId =
    connectedAccounts.find((a) => a.isDefault)?.id ?? connectedAccounts[0]?.id ?? "";

  const activeAccountId =
    selectedAccountId === EMAIL_ACCOUNT_ALL_MAILBOXES
      ? EMAIL_ACCOUNT_ALL_MAILBOXES
      : selectedAccountId || defaultAccountId || EMAIL_ACCOUNT_ALL_MAILBOXES;

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
          if (fromUrl && list.some((a) => a.id === fromUrl)) return fromUrl;
          if (prev && (prev === EMAIL_ACCOUNT_ALL_MAILBOXES || list.some((a) => a.id === prev))) return prev;
          if (connected.length > 1) return EMAIL_ACCOUNT_ALL_MAILBOXES;
          return connected[0]?.id ?? EMAIL_ACCOUNT_ALL_MAILBOXES;
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
    if (!user || !companyId || !access.canRead || accounts.length === 0) return;
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

  const backgroundSyncStarted = useRef(false);

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

  useEffect(() => {
    if (!user || !companyId || !access.canWrite || connectedAccounts.length === 0) return;
    if (backgroundSyncStarted.current) return;
    backgroundSyncStarted.current = true;
    void (async () => {
      try {
        const token = await getToken();
        for (let round = 0; round < 6; round++) {
          const res = await fetch("/api/company/email-mailbox/accounts/sync-all", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, maxMessages: 25 }),
          });
          const data = await parseEmailApiResponse<{ hasMore?: boolean }>(res);
          if (!data.ok || !data.hasMore) break;
        }
        await loadMessages();
        await loadAccounts();
      } catch {
        /* tiché — ruční sync zůstává */
      }
    })();
  }, [user, companyId, access.canWrite, connectedAccounts.length, getToken, loadMessages, loadAccounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        m.subject.toLowerCase().includes(q) ||
        m.from.toLowerCase().includes(q) ||
        (m.customerName ?? "").toLowerCase().includes(q)
    );
  }, [messages, search]);

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
      }
    },
    [user, companyId, getToken, access.canWrite]
  );

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
      await loadAccounts();
    } finally {
      setBusy(false);
    }
  }

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
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
    <div className="flex min-h-0 flex-1 flex-col">
      {connectedAccounts.length === 0 && accounts.length > 0 ? (
        <div className="mx-3 mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Všechny účty jsou odpojené. Historii zpráv stále vidíte níže. Nový e-mail připojte v{" "}
          <Link href="/portal/settings" className="text-primary underline">
            Profil → Moje e-mailové účty
          </Link>
          .
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside
        className={cn(
          "w-full shrink-0 border-b lg:w-56 lg:border-b-0 lg:border-r p-3",
          mobilePane !== "folders" && "hidden lg:block"
        )}
      >
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Moje schránka</p>
        {connectedAccounts.length >= 1 ? (
          <Select value={activeAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="mb-3 w-full min-h-[44px]">
              <SelectValue placeholder="Schránka" />
            </SelectTrigger>
            <SelectContent>
              {connectedAccounts.length > 1 ? (
                <SelectItem value={EMAIL_ACCOUNT_ALL_MAILBOXES}>Všechny moje schránky</SelectItem>
              ) : null}
              {connectedAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <nav className="flex flex-col gap-0.5 max-h-[50vh] lg:max-h-none overflow-y-auto">
          {EMAIL_PORTAL_FOLDERS.map((f) => {
            const count = f.countActive ? folderCounts[f.id] : undefined;
            return (
              <Button
                key={f.id}
                variant={folder === f.id ? "secondary" : "ghost"}
                size="sm"
                className="justify-between gap-2 min-h-[36px]"
                onClick={() => {
                  setFolder(f.id);
                  setMobilePane("list");
                }}
              >
                <span className="truncate text-left">{f.label}</span>
                {typeof count === "number" && count > 0 ? (
                  <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-xs font-medium text-primary">
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
          className="mt-4 w-full min-h-[44px]"
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

      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <div className="flex gap-2 border-b p-2 lg:hidden">
          <Button size="sm" variant={mobilePane === "folders" ? "secondary" : "outline"} onClick={() => setMobilePane("folders")}>
            Složky
          </Button>
          <Button size="sm" variant={mobilePane === "list" ? "secondary" : "outline"} onClick={() => setMobilePane("list")}>
            Seznam
          </Button>
        </div>
        <div
          className={cn(
            "min-w-0 border-b lg:w-[min(100%,22rem)] lg:border-b-0 lg:border-r flex flex-col",
            mobilePane === "detail" && "hidden lg:flex",
            mobilePane === "folders" && "hidden lg:flex"
          )}
        >
          <div className="p-2 border-b">
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
          <div className="max-h-[50vh] lg:max-h-none flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="p-4 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Žádné zprávy.</p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={cn(
                    "w-full border-b px-3 py-2 text-left text-sm hover:bg-muted/50",
                    selectedId === m.id && "bg-muted",
                    !m.isRead && "font-semibold"
                  )}
                  onClick={() => void loadDetail(m.id)}
                >
                  <p className="truncate flex items-center gap-1">
                    <span>{priorityEmoji(String(m.aiPriority ?? "NORMAL") as "NORMAL")}</span>
                    {(m.attachmentCount ?? 0) > 0 ? (
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                    <span className="truncate">{m.subject}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.from}</p>
                  {activeAccountId === EMAIL_ACCOUNT_ALL_MAILBOXES && m.mailboxEmail ? (
                    <p className="truncate text-xs text-primary/80">Schránka: {m.mailboxEmail}</p>
                  ) : null}
                  {m.staleNeedsReply ? (
                    <p className="text-xs text-amber-600">Čeká na odpověď</p>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>

        <div className={cn("min-w-0 flex-1 p-3 sm:p-4", mobilePane !== "detail" && "max-lg:hidden")}>
          {composeOpen ? (
            <div className="space-y-3 max-w-xl">
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
            <p className="text-muted-foreground text-sm">Vyberte zprávu v seznamu.</p>
          ) : (
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
