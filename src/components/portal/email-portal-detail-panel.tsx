"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, Check, Bell, UserPlus, Briefcase, AlertTriangle } from "lucide-react";
import {
  EMAIL_AI_CATEGORY_LABELS,
  emailPriorityLabel,
} from "@/lib/email-mailbox/category-labels";
import type { EmailAiCategory } from "@/lib/email-mailbox/intelligence-types";
import { EMAIL_WORKFLOW_STATE_LABELS } from "@/lib/email-mailbox/intelligence-types";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import { EmailAttachmentsSection } from "@/components/portal/email-attachments-section";
import {
  EmailReplyAttachments,
  type LocalReplyFile,
} from "@/components/portal/email-reply-attachments";
import type { JobDocumentEmailAttachmentRef } from "@/lib/job-document-email-attachments";

export type EmailDetailModel = {
  id: string;
  from: string;
  subject: string;
  receivedAt: string | null;
  textBody?: string | null;
  emailAccountId: string;
  aiSummary?: string | null;
  aiInsights?: string[] | null;
  aiDraftReply?: string | null;
  aiCategory?: string | null;
  aiPriority?: string | null;
  needsReply?: boolean;
  requiresAction?: boolean;
  workflowState?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  jobId?: string | null;
  jobLabel?: string | null;
  suggestedCustomerId?: string | null;
  suggestedJobId?: string | null;
  suggestedCustomerName?: string | null;
  suggestedJobLabel?: string | null;
  jobMatchConfidence?: string | null;
  inquiryDraft?: Record<string, unknown> | null;
  assignmentNote?: string | null;
  assignmentDueAt?: string | null;
  attachments?: EmailMessageAttachmentMeta[] | null;
};

export type ThreadMessage = {
  id: string;
  direction: string;
  from: string;
  textBody?: string | null;
  receivedAt: string | null;
};

export type TimelineEvent = {
  label: string;
  createdAt: string | null;
};

export type AssignableEmployee = {
  employeeId: string;
  userId: string;
  displayName: string;
};

type Props = {
  detail: EmailDetailModel;
  canWrite: boolean;
  busy: boolean;
  replyText: string;
  onReplyText: (v: string) => void;
  assignCustomerId: string;
  assignJobId: string;
  shareWithJob: boolean;
  onAssignCustomerId: (v: string) => void;
  onAssignJobId: (v: string) => void;
  onShareWithJob: (v: boolean) => void;
  employees: AssignableEmployee[];
  assigneeUserId: string;
  onAssigneeUserId: (v: string) => void;
  assignNote: string;
  onAssignNote: (v: string) => void;
  assignDue: string;
  onAssignDue: (v: string) => void;
  thread: ThreadMessage[];
  timeline: TimelineEvent[];
  onBack?: () => void;
  onAiDraft: (tone?: "default" | "shorter" | "formal" | "friendly") => void;
  onReply: () => void;
  onForward: () => void;
  onResolve: () => void;
  onAssignLinks: () => void;
  onAssignEmailToJob: () => void;
  onAssignEmployee: () => void;
  onReminder: (preset: string) => void;
  onApplySuggestedJob: () => void;
  companyId: string;
  getToken: () => Promise<string>;
  onAttachmentsLinked?: () => void;
  replyLocalFiles: LocalReplyFile[];
  onReplyLocalFilesChange: (files: LocalReplyFile[]) => void;
  forwardAttachmentIds: string[];
  onForwardAttachmentIdsChange: (ids: string[]) => void;
  rajmondataRefs: (JobDocumentEmailAttachmentRef & { jobId: string })[];
  onRajmondataRefsChange: (refs: (JobDocumentEmailAttachmentRef & { jobId: string })[]) => void;
  forwardMode?: boolean;
};

function EmailAiCategoryActions(props: {
  category: EmailAiCategory;
  canWrite: boolean;
  busy: boolean;
  inquiryDraft: Record<string, unknown> | null | undefined;
  onAssignEmailToJob: () => void;
}) {
  const { category, canWrite, busy, inquiryDraft, onAssignEmailToJob } = props;
  if (!canWrite) return null;

  if (category === "INQUIRY" && inquiryDraft) {
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" asChild>
          <Link href="/portal/leads">Vytvořit poptávku</Link>
        </Button>
      </div>
    );
  }

  if (category === "INVOICE" || category === "DOCUMENT") {
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="default" asChild>
          <Link href="/portal/documents">Zařadit fakturu / doklad</Link>
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onAssignEmailToJob}>
          Přiřadit k zakázce
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href="/portal/documents">Uložit do dokladů</Link>
        </Button>
      </div>
    );
  }

  if (category === "ORDER") {
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="default" asChild>
          <Link href="/portal/jobs">Vytvořit / přiřadit objednávku</Link>
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onAssignEmailToJob}>
          Přiřadit k zakázce
        </Button>
      </div>
    );
  }

  if (category === "INQUIRY") {
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" asChild>
          <Link href="/portal/leads">Vytvořit poptávku</Link>
        </Button>
      </div>
    );
  }

  return null;
}

export function EmailPortalDetailPanel(props: Props) {
  const d = props.detail;
  const cat = (d.aiCategory ?? "OTHER") as EmailAiCategory;
  const catLabel = EMAIL_AI_CATEGORY_LABELS[cat] ?? d.aiCategory ?? "—";
  const pri = String(d.aiPriority ?? "NORMAL");
  const insightTail = (d.aiInsights ?? []).slice(d.needsReply || d.requiresAction ? 1 : 0);

  return (
    <div className="w-full min-w-0 space-y-4 bg-background text-gray-900">
      {props.onBack ? (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={props.onBack}>
          ← Zpět
        </Button>
      ) : null}

      {props.canWrite ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 pb-3">
          <Button size="sm" disabled={props.busy} onClick={props.onReply}>
            Odpovědět
          </Button>
          <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onForward}>
            Přeposlat
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-violet-200 bg-violet-50/80 text-violet-950 hover:bg-violet-100"
            disabled={props.busy}
            onClick={() => props.onAiDraft()}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1 text-primary" /> AI odpověď
          </Button>
          <span className="hidden sm:inline h-5 w-px bg-border mx-0.5" aria-hidden />
          <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onAssignEmployee}>
            <UserPlus className="h-3.5 w-3.5 mr-1" /> Přiřadit
          </Button>
          <Select onValueChange={(v) => props.onReminder(v)}>
            <SelectTrigger className="h-8 w-[140px]">
              <Bell className="h-3.5 w-3.5 mr-1 shrink-0" />
              <SelectValue placeholder="Připomenout" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Za 1 hodinu</SelectItem>
              <SelectItem value="today">Dnes</SelectItem>
              <SelectItem value="tomorrow">Zítra</SelectItem>
              <SelectItem value="3d">Za 3 dny</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onAssignEmailToJob}>
            <Briefcase className="h-3.5 w-3.5 mr-1" /> Zakázka
          </Button>
          <span className="hidden sm:inline h-5 w-px bg-border mx-0.5" aria-hidden />
          <Button size="sm" variant="default" disabled={props.busy} onClick={props.onResolve}>
            <Check className="h-3.5 w-3.5 mr-1" /> Vyřízeno
          </Button>
        </div>
      ) : null}

      <div>
        <h1 className="text-lg font-semibold break-words">{d.subject}</h1>
        <p className="text-sm text-muted-foreground break-all">Od: {d.from}</p>
        <p className="text-xs text-muted-foreground">
          {d.receivedAt ? new Date(d.receivedAt).toLocaleString("cs-CZ") : ""}
          {d.workflowState
            ? ` · ${EMAIL_WORKFLOW_STATE_LABELS[d.workflowState as keyof typeof EMAIL_WORKFLOW_STATE_LABELS] ?? d.workflowState}`
            : ""}
        </p>
        {d.jobId ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span>
              <span className="text-muted-foreground">Zakázka: </span>
              <span className="font-medium">{d.jobLabel ?? d.jobId}</span>
            </span>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/portal/jobs/${encodeURIComponent(d.jobId)}`}>Otevřít zakázku</Link>
            </Button>
            {props.canWrite ? (
              <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onAssignEmailToJob}>
                Změnit
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-sm space-y-3">
        <p className="flex items-center gap-2 font-semibold text-gray-900">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          RAJMONDATA AI
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2 text-gray-900">
          <p>
            <span className="text-gray-600">Kategorie: </span>
            <span className="font-medium">{catLabel}</span>
          </p>
          <p>
            <span className="text-gray-600">Priorita: </span>
            <span className="font-medium">{emailPriorityLabel(pri)}</span>
          </p>
          <p className="sm:col-span-2">
            <span className="text-gray-600">Vyžaduje odpověď: </span>
            <span className="font-medium">{d.needsReply ? "Ano" : "Ne"}</span>
          </p>
        </div>
        {(d.needsReply || d.requiresAction) && (d.aiInsights?.length || d.aiSummary) ? (
          <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-orange-950">
              <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600" />
              Vyžaduje reakci
            </p>
            <p className="mt-1 text-sm text-orange-950/90">
              {(d.aiInsights ?? [])[0] ?? d.aiSummary}
            </p>
          </div>
        ) : null}
        {(d.suggestedCustomerName || d.suggestedCustomerId) && (
          <p>
            <span className="text-muted-foreground">Pravděpodobný zákazník: </span>
            {d.suggestedCustomerName ?? d.suggestedCustomerId}
          </p>
        )}
        {(d.suggestedJobLabel || d.suggestedJobId) && (
          <div className="flex flex-wrap items-center gap-2">
            <span>
              <span className="text-muted-foreground">Pravděpodobná zakázka: </span>
              {d.suggestedJobLabel ?? d.suggestedJobId}
              {d.jobMatchConfidence ? ` (shoda: ${d.jobMatchConfidence})` : ""}
            </span>
            {props.canWrite && d.jobMatchConfidence === "high" ? (
              <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onApplySuggestedJob}>
                Přiřadit
              </Button>
            ) : null}
          </div>
        )}
        {d.aiSummary ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Shrnutí</p>
            <p className="mt-1 text-gray-900 leading-relaxed">{d.aiSummary}</p>
          </div>
        ) : null}
        {insightTail.length > 0 ? (
          <ul className="space-y-2">
            {insightTail.map((line) => (
              <li
                key={line}
                className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900 leading-relaxed"
              >
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        <EmailAiCategoryActions
          category={cat}
          canWrite={props.canWrite}
          busy={props.busy}
          inquiryDraft={d.inquiryDraft}
          onAssignEmailToJob={props.onAssignEmailToJob}
        />
      </div>

      {props.thread.length > 1 ? (
        <div className="space-y-2 border rounded-md p-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Konverzace</p>
          {props.thread.map((t) => (
            <div
              key={t.id}
              className={`text-sm border-l-2 pl-3 ${t.direction === "outbound" ? "border-primary" : "border-muted-foreground/40"}`}
            >
              <p className="text-xs text-muted-foreground">{t.from}</p>
              <p className="whitespace-pre-wrap break-words">{t.textBody}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-900 border border-gray-200 rounded-md bg-white p-4 max-w-[min(100%,1000px)]">
          {d.textBody}
        </div>
      )}

      {props.canWrite ? (
        <>
          <EmailReplyAttachments
            companyId={props.companyId}
            jobId={d.jobId ?? d.suggestedJobId}
            sourceAttachments={d.attachments}
            forwardMode={props.forwardMode}
            getToken={props.getToken}
            localFiles={props.replyLocalFiles}
            onLocalFilesChange={props.onReplyLocalFilesChange}
            forwardAttachmentIds={props.forwardAttachmentIds}
            onForwardAttachmentIdsChange={props.onForwardAttachmentIdsChange}
            rajmondataRefs={props.rajmondataRefs}
            onRajmondataRefsChange={props.onRajmondataRefsChange}
          />
          <Textarea rows={5} value={props.replyText} onChange={(e) => props.onReplyText(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={props.busy} onClick={props.onReply}>
              Odpovědět
            </Button>
            <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onForward}>
              Přeposlat
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={props.busy}
              onClick={() => props.onAiDraft()}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" /> AI odpověď
            </Button>
            <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onAiDraft("shorter")}>
              Zkrátit
            </Button>
            <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onAiDraft("formal")}>
              Formálnější
            </Button>
            <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onAiDraft("friendly")}>
              Přátelštější
            </Button>
            <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onAiDraft()}>
              Regenerovat
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 border-t pt-4">
            <p className="col-span-full text-sm font-medium">Přiřadit pracovníkovi (interně)</p>
            <Select value={props.assigneeUserId} onValueChange={props.onAssigneeUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Zaměstnanec" />
              </SelectTrigger>
              <SelectContent>
                {props.employees.map((e) => (
                  <SelectItem key={e.userId} value={e.userId}>
                    {e.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="datetime-local" value={props.assignDue} onChange={(ev) => props.onAssignDue(ev.target.value)} />
            <Input
              className="col-span-full"
              placeholder="Poznámka k předání"
              value={props.assignNote}
              onChange={(ev) => props.onAssignNote(ev.target.value)}
            />
            <Button size="sm" variant="secondary" disabled={props.busy || !props.assigneeUserId} onClick={props.onAssignEmployee}>
              Předat kolegovi
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 border-t pt-4">
            <p className="col-span-full text-sm font-medium">Zákazník / zakázka (ruční nebo vyhledání)</p>
            <Input placeholder="ID zákazníka" value={props.assignCustomerId} onChange={(e) => props.onAssignCustomerId(e.target.value)} />
            <Input placeholder="ID zakázky" value={props.assignJobId} onChange={(e) => props.onAssignJobId(e.target.value)} />
            <label className="flex items-center gap-2 text-sm col-span-full">
              <Checkbox checked={props.shareWithJob} onCheckedChange={(v) => props.onShareWithJob(Boolean(v))} disabled={!props.assignJobId.trim()} />
              Zveřejnit obsah u zakázky
            </label>
            <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onAssignLinks}>
              Uložit propojení
            </Button>
          </div>
        </>
      ) : null}

      <EmailAttachmentsSection
        companyId={props.companyId}
        messageId={d.id}
        attachments={d.attachments}
        canWrite={props.canWrite}
        busy={props.busy}
        getToken={props.getToken}
        onLinked={props.onAttachmentsLinked}
      />

      {props.timeline.length > 0 ? (
        <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
          <p className="font-semibold uppercase">Historie</p>
          {props.timeline.map((e, i) => (
            <p key={`${e.label}-${i}`}>
              {e.createdAt ? new Date(e.createdAt).toLocaleString("cs-CZ") : "—"} {e.label}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
