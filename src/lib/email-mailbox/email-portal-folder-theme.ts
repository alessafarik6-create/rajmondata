import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Bot,
  Briefcase,
  ClipboardList,
  FileText,
  Inbox,
  MailWarning,
  Package,
  Send,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  Wrench,
  AlertCircle,
  Clock,
  ShieldAlert,
} from "lucide-react";
import type { EmailMessageWorkflowView } from "@/lib/email-mailbox/intelligence-types";

export type EmailFolderTheme = {
  icon: LucideIcon;
  /** Levý pruh + ikona */
  accentClass: string;
  /** Badge počtu */
  badgeClass: string;
  activeRowClass: string;
};

export const EMAIL_FOLDER_THEME: Partial<Record<EmailMessageWorkflowView, EmailFolderTheme>> = {
  inbox: {
    icon: Inbox,
    accentClass: "text-blue-600",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    activeRowClass: "bg-blue-50/90 border-l-blue-600 dark:bg-blue-950/40",
  },
  waiting_reply: {
    icon: Clock,
    accentClass: "text-orange-700",
    badgeClass: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100",
    activeRowClass: "bg-orange-50/90 border-l-orange-600 dark:bg-orange-950/30",
  },
  needs_action: {
    icon: AlertCircle,
    accentClass: "text-red-600",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    activeRowClass: "bg-red-50/90 border-l-red-600 dark:bg-red-950/30",
  },
  assigned_to_me: {
    icon: UserCheck,
    accentClass: "text-violet-600",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    activeRowClass: "bg-violet-50/90 border-l-violet-600 dark:bg-violet-950/30",
  },
  delegated: {
    icon: Users,
    accentClass: "text-teal-600",
    badgeClass: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-100",
    activeRowClass: "bg-teal-50/90 border-l-teal-600 dark:bg-teal-950/30",
  },
  ai_suggestions: {
    icon: Sparkles,
    accentClass: "text-indigo-600",
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
    activeRowClass: "bg-indigo-50/90 border-l-indigo-600 dark:bg-indigo-950/30",
  },
  cat_jobs: {
    icon: Briefcase,
    accentClass: "text-blue-900",
    badgeClass: "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
    activeRowClass: "bg-slate-100/90 border-l-slate-800 dark:bg-slate-900/50",
  },
  cat_inquiries: {
    icon: ClipboardList,
    accentClass: "text-orange-700",
    badgeClass: "bg-orange-100 text-orange-900",
    activeRowClass: "bg-orange-50/80 border-l-orange-600",
  },
  cat_invoices_docs: {
    icon: FileText,
    accentClass: "text-emerald-700",
    badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    activeRowClass: "bg-emerald-50/80 border-l-emerald-600",
  },
  cat_orders: {
    icon: Package,
    accentClass: "text-blue-700",
    badgeClass: "bg-blue-100 text-blue-900",
    activeRowClass: "bg-blue-50/80 border-l-blue-700",
  },
  cat_complaints: {
    icon: Wrench,
    accentClass: "text-red-700",
    badgeClass: "bg-red-100 text-red-900",
    activeRowClass: "bg-red-50/80 border-l-red-700",
  },
  cat_suppliers: {
    icon: Bot,
    accentClass: "text-slate-700",
    badgeClass: "bg-slate-200 text-slate-800",
    activeRowClass: "bg-slate-100/90 border-l-slate-600",
  },
  sent: {
    icon: Send,
    accentClass: "text-slate-600",
    badgeClass: "bg-slate-200 text-slate-700",
    activeRowClass: "bg-slate-100/90 border-l-slate-500",
  },
  drafts: {
    icon: FileText,
    accentClass: "text-slate-500",
    badgeClass: "bg-slate-200 text-slate-700",
    activeRowClass: "bg-slate-100 border-l-slate-400",
  },
  archive: {
    icon: Archive,
    accentClass: "text-slate-500",
    badgeClass: "bg-slate-200 text-slate-600",
    activeRowClass: "bg-slate-100 border-l-slate-400",
  },
  spam: {
    icon: ShieldAlert,
    accentClass: "text-red-600",
    badgeClass: "bg-red-100 text-red-800",
    activeRowClass: "bg-red-50/80 border-l-red-500",
  },
  trash: {
    icon: Trash2,
    accentClass: "text-slate-600",
    badgeClass: "bg-slate-200 text-red-800",
    activeRowClass: "bg-slate-100 border-l-red-400",
  },
};

export function folderTheme(id: EmailMessageWorkflowView): EmailFolderTheme {
  return (
    EMAIL_FOLDER_THEME[id] ?? {
      icon: MailWarning,
      accentClass: "text-muted-foreground",
      badgeClass: "bg-muted text-muted-foreground",
      activeRowClass: "bg-muted/60 border-l-primary",
    }
  );
}
