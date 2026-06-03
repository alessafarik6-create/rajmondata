"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { useCollection, useDoc, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExpandableNoteText } from "@/components/jobs/job-note-text-block";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { safeTime } from "@/lib/date-safe";
import {
  buildMessageAuthorPersistFields,
  compareMessagesByCreatedAt,
} from "@/lib/format-message-date";
import { JobMessageHeader } from "@/components/jobs/job-message-header";
import {
  buildJobCustomerChatContext,
  customerChatMessageMatchesJob,
  customerConversationId,
  type JobCustomerChatContext,
} from "@/lib/job-customer-chat";
import { notifyJobActivity } from "@/lib/job-activity-notify-client";
import { MIN_EMPLOYEE_PASSWORD_LENGTH } from "@/lib/employee-password-policy";
import { Loader2 } from "lucide-react";

type MessageRow = Record<string, unknown> & { id: string };

type Props = {
  firestore: unknown;
  companyId: string;
  jobId: string;
  job: Record<string, unknown>;
  user: User;
  authorName: string;
  className?: string;
  /** CRM zákazník z detailu zakázky (volitelné — urychlí rozlišení). */
  customer?: Record<string, unknown> | null;
  customerPortalUserDocId?: string | null;
};

export function JobCustomerChatThread({
  firestore,
  companyId,
  jobId,
  job,
  user,
  authorName,
  className,
  customer = null,
  customerPortalUserDocId = null,
}: Props) {
  const { toast } = useToast();
  const fs = firestore as ReturnType<typeof import("firebase/firestore").getFirestore> | null;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(true);
  const [apiContext, setApiContext] = useState<JobCustomerChatContext | null>(null);
  const [portalUidOverride, setPortalUidOverride] = useState<string | null>(null);
  const [portalDialogOpen, setPortalDialogOpen] = useState(false);
  const [portalEmail, setPortalEmail] = useState("");
  const [portalPassword, setPortalPassword] = useState("");
  const [portalPassword2, setPortalPassword2] = useState("");
  const [portalSubmitting, setPortalSubmitting] = useState(false);
  const [portalActionLoading, setPortalActionLoading] = useState(false);

  const localContext = useMemo(
    () =>
      buildJobCustomerChatContext(job, {
        customer,
        customerPortalUserDocId,
      }),
    [job, customer, customerPortalUserDocId]
  );

  const ctx = useMemo(() => {
    if (!apiContext) return localContext;
    const portalUid =
      portalUidOverride ||
      apiContext.portalUid ||
      localContext.portalUid;
    return {
      ...apiContext,
      portalUid,
      displayName: apiContext.displayName || localContext.displayName,
      email: apiContext.email || localContext.email,
      crmCustomerId: apiContext.crmCustomerId || localContext.crmCustomerId,
      canChat: Boolean(portalUid),
      hasCustomerAssignment:
        apiContext.hasCustomerAssignment || localContext.hasCustomerAssignment,
      needsPortalAccount:
        Boolean(portalUid) === false &&
        (apiContext.needsPortalAccount || localContext.needsPortalAccount) &&
        Boolean(apiContext.crmCustomerId || localContext.crmCustomerId),
    } satisfies JobCustomerChatContext;
  }, [apiContext, localContext, portalUidOverride]);

  const customerUid = ctx.portalUid;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setResolving(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/company/jobs/resolve-customer-chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ companyId, jobId }),
        });
        const data = (await res.json().catch(() => ({}))) as JobCustomerChatContext & {
          error?: string;
          ok?: boolean;
        };
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Rozpoznání zákazníka selhalo.");
        if (!cancelled) {
          setApiContext({
            displayName: data.displayName,
            email: data.email,
            crmCustomerId: data.crmCustomerId,
            portalUid: data.portalUid,
            hasCustomerAssignment: data.hasCustomerAssignment,
            canChat: data.canChat,
            needsPortalAccount: data.needsPortalAccount,
          });
        }
      } catch {
        if (!cancelled) setApiContext(null);
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, companyId, jobId, job, customer, customerPortalUserDocId]);

  const conversationId = customerUid ? customerConversationId(customerUid) : null;

  const conversationRef = useMemoFirebase(
    () =>
      fs && conversationId
        ? doc(fs, "companies", companyId, "customer_conversations", conversationId)
        : null,
    [fs, companyId, conversationId]
  );
  const { data: conversation } = useDoc(conversationRef);

  const messagesQuery = useMemoFirebase(
    () =>
      fs && conversationId
        ? query(
            collection(
              fs,
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
    [fs, companyId, conversationId]
  );
  const { data: messagesRaw = [], isLoading } = useCollection(messagesQuery);

  const messages = useMemo(() => {
    const list = (Array.isArray(messagesRaw) ? messagesRaw : []) as MessageRow[];
    return list
      .filter((m) => customerChatMessageMatchesJob(m, jobId, { includeLegacyWithoutJobId: true }))
      .slice()
      .sort(compareMessagesByCreatedAt);
  }, [messagesRaw, jobId]);

  useEffect(() => {
    if (!fs || !conversationId || !user.uid) return;
    const unreadFromCustomer = messages.filter(
      (m) =>
        String(m.senderRole ?? "") === "customer" &&
        m.isRead !== true &&
        String(m.senderId ?? "") !== user.uid
    );
    if (!unreadFromCustomer.length) return;
    const batch = writeBatch(fs);
    for (const m of unreadFromCustomer) {
      batch.update(
        doc(
          fs,
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
    batch.update(doc(fs, "companies", companyId, "customer_conversations", conversationId), {
      unreadForAdminCount: 0,
    });
    void batch.commit().catch(() => {});
  }, [fs, companyId, conversationId, user.uid, messages]);

  const openPortalDialog = useCallback(() => {
    setPortalEmail(ctx.email || "");
    setPortalPassword("");
    setPortalPassword2("");
    setPortalDialogOpen(true);
  }, [ctx.email]);

  const handleCreatePortalAccount = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const crmId = ctx.crmCustomerId;
      if (!crmId) {
        toast({
          variant: "destructive",
          title: "Chybí zákazník v CRM",
          description: "Nejdříve přiřaďte zakázku ke zákazníkovi v CRM.",
        });
        return;
      }
      if (portalPassword.length < MIN_EMPLOYEE_PASSWORD_LENGTH) {
        toast({
          variant: "destructive",
          title: "Slabé heslo",
          description: `Heslo musí mít alespoň ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků.`,
        });
        return;
      }
      if (portalPassword !== portalPassword2) {
        toast({ variant: "destructive", title: "Hesla se neshodují" });
        return;
      }
      setPortalSubmitting(true);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/company/customers/create-portal-auth", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            customerId: crmId,
            email: portalEmail.trim() || undefined,
            password: portalPassword,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          uid?: string;
        };
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Vytvoření účtu selhalo.");
        }
        const newUid = typeof data.uid === "string" ? data.uid.trim() : "";
        if (newUid) {
          setPortalUidOverride(newUid);
          if (fs) {
            await updateDoc(doc(fs, "companies", companyId, "jobs", jobId), {
              customerPortalUserIds: arrayUnion(newUid),
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }
        }
        toast({
          title: "Přístup zákazníka vytvořen",
          description: data.message || "Zákazník se může přihlásit do portálu.",
        });
        setPortalDialogOpen(false);
        setPortalPassword("");
        setPortalPassword2("");
      } catch (err: unknown) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: err instanceof Error ? err.message : "Nepodařilo se vytvořit účet.",
        });
      } finally {
        setPortalSubmitting(false);
      }
    },
    [ctx.crmCustomerId, portalEmail, portalPassword, portalPassword2, user, toast, fs, companyId, jobId]
  );

  const handleSyncPortalJobs = useCallback(async () => {
    const crmId = ctx.crmCustomerId;
    if (!crmId) return;
    setPortalActionLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/customers/sync-portal-linked-jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ customerId: crmId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; count?: number };
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Synchronizace selhala.");
      }
      toast({
        title: "Zakázky synchronizovány",
        description: `Do portálu je přiřazeno ${data.count ?? 0} zakázek.`,
      });
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: err instanceof Error ? err.message : "Synchronizace selhala.",
      });
    } finally {
      setPortalActionLoading(false);
    }
  }, [ctx.crmCustomerId, user, toast]);

  const send = useCallback(async () => {
    if (!fs || !conversationId || !customerUid || !draft.trim()) return;
    const text = draft.trim();
    setSending(true);
    try {
      await addDoc(
        collection(
          fs,
          "companies",
          companyId,
          "customer_conversations",
          conversationId,
          "messages"
        ),
        {
          senderId: user.uid,
          senderRole: "admin",
          senderName: authorName,
          text,
          jobId,
          ...buildMessageAuthorPersistFields({
            userId: user.uid,
            authorName,
            authorRole: "admin",
          }),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          isRead: false,
          attachments: [],
        }
      );
      await setDoc(
        doc(fs, "companies", companyId, "customer_conversations", conversationId),
        {
          organizationId: companyId,
          customerUserId: customerUid,
          customerId: ctx.crmCustomerId || (typeof job.customerId === "string" ? job.customerId : null),
          jobId,
          lastMessageAt: serverTimestamp(),
          lastMessagePreview: text.slice(0, 180),
          unreadForCustomerCount: increment(1),
          unreadForAdminCount: 0,
        },
        { merge: true }
      );
      setDraft("");
      const token = await user.getIdToken();
      void notifyJobActivity({
        idToken: token,
        companyId,
        jobId,
        eventType: "customer_job_chat",
        messagePreview: text,
        entityId: conversationId,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Zprávu se nepodařilo odeslat",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSending(false);
    }
  }, [
    fs,
    conversationId,
    customerUid,
    draft,
    companyId,
    jobId,
    job,
    user,
    authorName,
    toast,
    ctx.crmCustomerId,
  ]);

  const customerInfoBlock = (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      <p className="font-medium text-foreground">{ctx.displayName}</p>
      {ctx.email ? (
        <p className="text-muted-foreground">{ctx.email}</p>
      ) : (
        <p className="text-muted-foreground">E-mail zákazníka není vyplněn</p>
      )}
    </div>
  );

  if (resolving && !ctx.hasCustomerAssignment) {
    return (
      <Card className={cn("border border-border bg-background", className)}>
        <CardHeader>
          <CardTitle className="text-lg">Chat se zákazníkem</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Načítám zákazníka…
        </CardContent>
      </Card>
    );
  }

  if (!ctx.hasCustomerAssignment) {
    return (
      <Card className={cn("border border-border bg-background", className)}>
        <CardHeader>
          <CardTitle className="text-lg">Chat se zákazníkem</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Zakázka nemá přiřazeného zákazníka. Nastavte zákazníka u zakázky nebo v CRM.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!customerUid) {
    return (
      <>
        <Card className={cn("border border-border bg-background", className)}>
          <CardHeader>
            <CardTitle className="text-lg">Chat se zákazníkem</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {customerInfoBlock}
            <p className="text-sm text-muted-foreground">
              {ctx.needsPortalAccount
                ? "Zákazník je přiřazen, ale nemá aktivní přístup do portálu. Vytvořte nebo synchronizujte přístup — poté bude chat k dispozici."
                : "Zákazník nemá portálový účet. Přiřaďte zakázku ke zákazníkovi v CRM a vytvořte přístup."}
            </p>
            {ctx.crmCustomerId ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={openPortalDialog}>
                  Vytvořit / synchronizovat přístup zákazníka
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={portalActionLoading}
                  onClick={() => void handleSyncPortalJobs()}
                >
                  {portalActionLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Synchronizuji…
                    </>
                  ) : (
                    "Synchronizovat zakázky v portálu"
                  )}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Dialog open={portalDialogOpen} onOpenChange={setPortalDialogOpen}>
          <DialogContent>
            <form onSubmit={(e) => void handleCreatePortalAccount(e)}>
              <DialogHeader>
                <DialogTitle>Přístup zákazníka do portálu</DialogTitle>
                <DialogDescription>
                  Zákazník se přihlásí stejně jako firma a uvidí svůj klientský portál včetně této zakázky.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="job-chat-portal-email">E-mail přihlášení</Label>
                  <Input
                    id="job-chat-portal-email"
                    type="email"
                    value={portalEmail}
                    onChange={(e) => setPortalEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="job-chat-portal-pw">Heslo</Label>
                  <Input
                    id="job-chat-portal-pw"
                    type="password"
                    minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
                    value={portalPassword}
                    onChange={(e) => setPortalPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="job-chat-portal-pw2">Heslo znovu</Label>
                  <Input
                    id="job-chat-portal-pw2"
                    type="password"
                    value={portalPassword2}
                    onChange={(e) => setPortalPassword2(e.target.value)}
                    required
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={portalSubmitting}>
                  {portalSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Vytvářím…
                    </>
                  ) : (
                    "Vytvořit přístup"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Card className={cn("border border-border bg-background text-foreground shadow-sm", className)}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
          <span>Chat se zákazníkem</span>
          <Badge variant="secondary" className="text-[10px] font-normal">
            Zákazník
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        {customerInfoBlock}
        <div className="min-h-[200px] max-h-[min(70vh,720px)] space-y-3 overflow-y-auto pr-1">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Načítám…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zatím žádné zprávy se zákazníkem k této zakázce.
            </p>
          ) : (
            messages.map((m) => {
              const mine = String(m.senderRole ?? m.createdByRole ?? "") === "admin";
              const authorOverride = mine
                ? undefined
                : String(m.senderName ?? m.createdByName ?? "Zákazník");
              const readLine =
                m.isRead === true
                  ? "přečteno"
                  : mine
                    ? "nepřečteno zákazníkem"
                    : "nepřečteno";
              return (
                <div
                  key={m.id}
                  className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[92%] min-w-0 rounded-2xl border bg-white px-3 py-2.5 shadow-sm break-words sm:max-w-[75%]",
                      mine
                        ? "border-emerald-300 rounded-br-md"
                        : "border-violet-200 rounded-bl-md"
                    )}
                  >
                    <JobMessageHeader message={m} authorNameOverride={authorOverride} />
                    <ExpandableNoteText text={String(m.text ?? m.message ?? "")} />
                    <div className="mt-1.5 text-xs text-gray-600">{readLine}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-stretch">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Napište zprávu zákazníkovi…"
            className="min-h-[44px] min-w-0 flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button
            type="button"
            className="min-h-[44px] shrink-0"
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
          >
            Odeslat zákazníkovi
          </Button>
        </div>
        {(conversation as { unreadForAdminCount?: number } | null)?.unreadForAdminCount ? (
          <p className="text-xs text-amber-700">
            Nepřečtené zprávy od zákazníka:{" "}
            {(conversation as { unreadForAdminCount?: number }).unreadForAdminCount}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
