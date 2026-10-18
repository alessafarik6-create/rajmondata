import type { Timestamp } from "firebase-admin/firestore";

export type ConsultationType = "phone" | "online";

export type ConsultationBookingStatus = "confirmed" | "cancelled" | "completed";

export type PlatformConsultationSettings = {
  workDays: number[];
  slotStartHour: number;
  slotEndHour: number;
  slotDurationMinutes: 15 | 30 | 45 | 60;
  breakMinutes: number;
  maxBookingsPerDay: number;
  blockedDates: string[];
  meetLinkTemplate?: string | null;
  adminNotifyEmail?: string | null;
  updatedAt?: Timestamp;
};

export type PlatformConsultationBooking = {
  organizationId?: string | null;
  organizationName: string;
  contactName: string;
  email: string;
  phone: string;
  consultationType: ConsultationType;
  dateYmd: string;
  timeSlot: string;
  note?: string | null;
  status: ConsultationBookingStatus;
  meetLink?: string | null;
  campaignId?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export const DEFAULT_CONSULTATION_SETTINGS: PlatformConsultationSettings = {
  workDays: [1, 2, 3, 4, 5],
  slotStartHour: 9,
  slotEndHour: 17,
  slotDurationMinutes: 30,
  breakMinutes: 15,
  maxBookingsPerDay: 8,
  blockedDates: [],
  meetLinkTemplate: null,
  adminNotifyEmail: null,
};
