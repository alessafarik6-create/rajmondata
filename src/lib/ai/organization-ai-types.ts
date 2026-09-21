import type { OrganizationAiEntityRef } from "@/lib/ai/organization-ai-entity-links";

export type AiPriority = "URGENT" | "HIGH" | "NORMAL" | "INFO";

export type OrganizationAiBriefingItem = {
  priority: AiPriority;
  icon: string;
  text: string;
  ref?: OrganizationAiEntityRef;
};

export type OrganizationAiEmailAccess =
  | { ok: true; mailboxId: string; emailAddress: string; connectionStatus: string }
  | { ok: false; code: string; userMessage: string };

export type OrganizationAiContextSnapshot = {
  generatedAt: string;
  organizationId: string;
  userId: string;
  user: {
    displayName: string;
    role: string;
  };
  activeMailboxId?: string | null;
  emailAccess?: OrganizationAiEmailAccess;
  modulesEnabled: Record<string, boolean>;
  permissions: Record<string, "none" | "read" | "write">;
  emails?: {
    mailboxId: string;
    emailAddress: string;
    waitingForReply: number;
    overdue: number;
    urgent: number;
    unread?: number;
    samples?: Array<{
      id: string;
      subject: string;
      sender?: string;
      receivedAt?: string;
      waitingHours?: number;
    }>;
  };
  jobs?: {
    active: number;
    overdue: number;
    overdueSamples?: Array<{ id: string; name: string; daysOverdue: number }>;
    installationsToday?: number;
  };
  documents?: { pendingClassification: number };
  finance?: {
    overdueInvoices: number;
    unpaidInvoices: number;
    overdueSamples?: Array<{ id: string; label: string }>;
  };
  leads?: { newRecent: number };
  calendar?: {
    todayMeetings: number;
    todayInstallations: number;
    nextEventLabel?: string;
  };
  production?: { waiting: number };
  cameras?: { total: number; online: number; offline: number };
  attendance?: { workingToday: number; absentToday?: number };
  fleet?: { inField?: number };
};

export type OrganizationAiBriefingResponse = {
  ok: true;
  greeting: string;
  intro: string;
  items: OrganizationAiBriefingItem[];
  attentionCount: number;
  contextGeneratedAt: string;
};

export type OrganizationAiAskResponse = {
  ok: true;
  answer: string;
  references: OrganizationAiEntityRef[];
  deniedModules?: string[];
};
