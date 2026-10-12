import type { Timestamp } from "firebase-admin/firestore";

export type LeadReminderStatus = "active" | "done";

export type LeadReminderRecord = {
  id: string;
  companyId: string;
  organizationId: string;
  leadKey: string;
  importLeadId: string;
  customerName: string;
  inquiryTitle: string;
  assignedUserId: string;
  assignedDisplayName: string | null;
  note: string;
  remindAt: string;
  status: LeadReminderStatus;
  notificationFired: boolean;
  firedAt: string | null;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
};

export type LeadReminderFirestore = {
  companyId: string;
  organizationId: string;
  leadKey: string;
  importLeadId: string;
  customerName: string;
  inquiryTitle: string;
  assignedUserId: string;
  assignedDisplayName?: string | null;
  note: string;
  remindAt: Timestamp;
  status: LeadReminderStatus;
  notificationFired?: boolean;
  firedAt?: Timestamp | null;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  completedAt?: Timestamp | null;
};

export function leadReminderOpenUrl(leadKey: string): string {
  return `/portal/leads?openLead=${encodeURIComponent(leadKey)}`;
}
