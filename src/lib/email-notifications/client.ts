"use client";

import { getAuth } from "firebase/auth";
import type { EmailModuleKey } from "./schema";

function companyApiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export type BrowserNotifyPayload = {
  companyId: string;
  module: EmailModuleKey;
  eventKey: string;
  entityId?: string;
  title: string;
  lines?: string[];
  actionPath?: string | null;
};

/**
 * Odešle požadavek na modulovou e-mailovou notifikaci (ověření na serveru + Resend).
 * Neblokuje UI — chyby jen do konzole.
 */
export async function sendModuleEmailNotificationFromBrowser(
  payload: BrowserNotifyPayload
): Promise<void> {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    const res = await fetch(companyApiUrl("/api/company/email-notifications/notify"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        companyId: payload.companyId,
        module: payload.module,
        eventKey: payload.eventKey,
        entityId: payload.entityId,
        title: payload.title,
        lines: payload.lines ?? [],
        actionPath: payload.actionPath ?? undefined,
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      console.warn("[email-notify]", res.status, j.error ?? res.statusText);
    }
  } catch (e) {
    console.warn("[email-notify] fetch failed", e);
  }
}

export async function syncCalendarEmailRemindersFromBrowser(input: {
  companyId: string;
  eventId: string;
  eventStartsAtIso: string;
  title: string;
  calendarKind: "meeting" | "measurement";
  cancel?: boolean;
}): Promise<void> {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    await fetch(companyApiUrl("/api/company/email-notifications/calendar-reminders"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
  } catch (e) {
    console.warn("[calendar-reminders] fetch failed", e);
  }
}
