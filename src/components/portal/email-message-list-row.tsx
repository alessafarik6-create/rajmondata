"use client";

import {
  Briefcase,
  Forward,
  CheckCircle2,
  Circle,
  Paperclip,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatEmailFromDisplay,
  formatEmailListDate,
  normalizeEmailPriority,
} from "@/lib/email-mailbox/email-list-format";

export type EmailListRowModel = {
  id: string;
  from: string;
  subject: string;
  receivedAt: string | null;
  isRead?: boolean;
  needsReply?: boolean;
  staleNeedsReply?: boolean;
  aiPriority?: string | null;
  attachmentCount?: number;
  aiReviewPending?: boolean;
  jobId?: string | null;
  jobLabel?: string | null;
  resolved?: boolean;
  aiSummary?: string | null;
  mailboxEmail?: string | null;
  workflowState?: string | null;
};

type Props = {
  message: EmailListRowModel;
  selected: boolean;
  showMailbox?: boolean;
  onSelect: () => void;
};

export function EmailMessageListRow(props: Props) {
  const m = props.message;
  const unread = !m.isRead;
  const pri = normalizeEmailPriority(m.aiPriority);
  const waiting = Boolean(m.staleNeedsReply || m.needsReply);
  const preview = (m.aiSummary ?? "").trim().slice(0, 140);

  return (
    <button
      type="button"
      className={cn(
        "w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm transition-colors",
        "hover:bg-slate-50/90",
        unread && "bg-sky-50/50",
        props.selected &&
          "border-l-[3px] border-l-primary bg-orange-50/70 pl-[calc(0.75rem-3px)]"
      )}
      onClick={props.onSelect}
    >
      <div className="flex items-start gap-2">
        <div className="mt-1.5 shrink-0 w-2 flex justify-center">
          {unread ? (
            <Circle className="h-2 w-2 fill-primary text-primary" aria-label="Nepřečteno" />
          ) : (
            <span className="h-2 w-2" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn("truncate text-[13px]", unread ? "font-semibold text-slate-900" : "font-medium text-slate-800")}>
              {formatEmailFromDisplay(m.from)}
            </p>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatEmailListDate(m.receivedAt)}
            </span>
          </div>
          <p className={cn("truncate text-[13px]", unread ? "font-semibold text-slate-900" : "text-slate-800")}>
            {m.subject || "(bez předmětu)"}
          </p>
          {preview ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-600 dark:text-slate-400">{preview}</p>
          ) : null}
          {props.showMailbox && m.mailboxEmail ? (
            <p className="truncate text-[11px] text-primary/80 mt-0.5">Schránka: {m.mailboxEmail}</p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {(m.attachmentCount ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-600" title="Příloha">
                <Paperclip className="h-3 w-3" />
              </span>
            ) : null}
            {m.aiReviewPending ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0 text-[10px] font-medium text-indigo-900">
                <Sparkles className="h-3 w-3" /> AI
              </span>
            ) : null}
            {waiting ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1.5 py-0 text-[10px] font-medium text-orange-950">
                <AlertTriangle className="h-3 w-3" /> Čeká na odpověď
              </span>
            ) : null}
            {m.jobId ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0 text-[10px] font-medium text-blue-950 max-w-[12rem] truncate">
                <Briefcase className="h-3 w-3 shrink-0" />
                {m.jobLabel ?? "Zakázka"}
              </span>
            ) : null}
            {m.resolved ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-800">
                <CheckCircle2 className="h-3 w-3" /> Vyřízeno
              </span>
            ) : null}
            {pri === "HIGH" || pri === "URGENT" ? (
              <span className="inline-flex h-2 w-2 rounded-full bg-red-600" title="Vysoká priorita" />
            ) : pri === "LOW" ? (
              <span className="text-[10px] text-slate-500">Nízká</span>
            ) : null}
            {m.workflowState === "delegated" ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-teal-800">
                <Forward className="h-3 w-3" /> Předáno
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
