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
import { Sparkles, Check, Bell, UserPlus, Briefcase } from "lucide-react";
import {
  EMAIL_AI_CATEGORY_LABELS,
  emailPriorityLabel,
} from "@/lib/email-mailbox/category-labels";
import { priorityEmoji } from "@/lib/email-mailbox/intelligence-types";
import type { EmailAiCategory } from "@/lib/email-mailbox/intelligence-types";
import { EMAIL_WORKFLOW_STATE_LABELS } from "@/lib/email-mailbox/intelligence-types";

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
  onAssignEmployee: () => void;
  onReminder: (preset: string) => void;
  onApplySuggestedJob: () => void;
};

export function EmailPortalDetailPanel(props: Props) {
  const d = props.detail;
  const cat = (d.aiCategory ?? "OTHER") as EmailAiCategory;
  const catLabel = EMAIL_AI_CATEGORY_LABELS[cat] ?? d.aiCategory ?? "—";
  const pri = String(d.aiPriority ?? "NORMAL");

  return (
    <div className="space-y-4 max-w-3xl">
      {props.onBack ? (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={props.onBack}>
          ← Zpět
        </Button>
      ) : null}

      {props.canWrite ? (
        <div className="flex flex-wrap gap-1.5 border-b pb-3">
          <Button size="sm" disabled={props.busy} onClick={props.onReply}>
            Odpovědět
          </Button>
          <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onForward}>
            Přeposlat
          </Button>
          <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onAiDraft()}>
            <Sparkles className="h-3.5 w-3.5 mr-1" /> AI odpověď
          </Button>
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
          <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onAssignLinks}>
            <Briefcase className="h-3.5 w-3.5 mr-1" /> Zakázka
          </Button>
          <Button size="sm" variant="default" disabled={props.busy} onClick={props.onResolve}>
            <Check className="h-3.5 w-3.5 mr-1" /> Vyřízeno
          </Button>
        </div>
      ) : null}

      <div>
        <h1 className="text-lg font-semibold break-words flex items-start gap-2">
          <span>{priorityEmoji(pri as "URGENT")}</span>
          <span>{d.subject}</span>
        </h1>
        <p className="text-sm text-muted-foreground break-all">Od: {d.from}</p>
        <p className="text-xs text-muted-foreground">
          {d.receivedAt ? new Date(d.receivedAt).toLocaleString("cs-CZ") : ""}
          {d.workflowState
            ? ` · ${EMAIL_WORKFLOW_STATE_LABELS[d.workflowState as keyof typeof EMAIL_WORKFLOW_STATE_LABELS] ?? d.workflowState}`
            : ""}
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
        <p className="font-semibold text-primary">RAJMONDATA AI</p>
        <p>
          <span className="text-muted-foreground">Kategorie: </span>
          {catLabel}
        </p>
        <p>
          <span className="text-muted-foreground">Priorita: </span>
          {emailPriorityLabel(pri)}
        </p>
        <p>
          <span className="text-muted-foreground">Vyžaduje odpověď: </span>
          {d.needsReply ? "Ano" : "Ne"}
        </p>
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
        {d.aiSummary ? <p className="text-muted-foreground">{d.aiSummary}</p> : null}
        {(d.aiInsights ?? []).map((line) => (
          <p key={line} className="text-amber-800 dark:text-amber-200">
            {line}
          </p>
        ))}
        {d.inquiryDraft && props.canWrite ? (
          <div className="rounded border border-dashed p-2 mt-2">
            <p className="font-medium">Vypadá to jako nová poptávka.</p>
            <Button size="sm" className="mt-2" asChild>
              <Link href="/portal/leads">Vytvořit poptávku</Link>
            </Button>
          </div>
        ) : null}
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
              <p className="whitespace-pre-wrap break-words line-clamp-6">{t.textBody}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm border rounded-md p-3 max-h-[40vh] overflow-y-auto">
          {d.textBody}
        </div>
      )}

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

      {props.canWrite ? (
        <>
          <Textarea rows={5} value={props.replyText} onChange={(e) => props.onReplyText(e.target.value)} />
          <div className="flex flex-wrap gap-2">
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
    </div>
  );
}
