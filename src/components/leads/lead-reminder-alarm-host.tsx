"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlarmClock, X } from "lucide-react";
import { collection, query, where, orderBy, limit } from "firebase/firestore";
import { useUser, useFirebase, useCollection, useMemoFirebase, useDoc } from "@/firebase";
import { doc } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { LEAD_REMINDERS_SUBCOLLECTION } from "@/lib/firestore-collections";
import {
  parseLeadReminderRow,
  patchLeadReminder,
  processDueLeadReminders,
} from "@/lib/leads/lead-reminder-client";
import type { LeadReminderRecord } from "@/lib/leads/lead-reminder-types";
import { formatRemindTimePrague } from "@/lib/leads/lead-reminder-datetime";
import { leadReminderOpenUrl } from "@/lib/leads/lead-reminder-types";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "rajmondata_lead_reminder_dismissed";
const ALARM_EVENT = "rajmondata-lead-reminder-alarm";

function readDismissed(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  try {
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...ids].slice(-80)));
  } catch {
    /* ignore */
  }
}

function playReminderChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      void ctx.close();
    }, 280);
  } catch {
    /* ignore */
  }
}

type ActiveToast = LeadReminderRecord;

export function LeadReminderAlarmHost() {
  const { user } = useUser();
  const { firestore } = useFirebase();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc(userRef);
  const companyId = (profile as { companyId?: string } | undefined)?.companyId;
  const pushEnabled =
    (profile as { notificationPreferences?: { pushEnabled?: boolean } } | undefined)
      ?.notificationPreferences?.pushEnabled !== false;

  const remindersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !user) return null;
    return query(
      collection(firestore, "companies", companyId, LEAD_REMINDERS_SUBCOLLECTION),
      where("assignedUserId", "==", user.uid),
      where("status", "==", "active"),
      orderBy("remindAt", "asc"),
      limit(40)
    );
  }, [firestore, companyId, user?.uid]);

  const { data: rawRows } = useCollection(remindersQuery);

  const reminders = useMemo(() => {
    const list = (rawRows ?? []) as Array<Record<string, unknown> & { id: string }>;
    return list
      .map((r) => parseLeadReminderRow(r.id, r))
      .filter(Boolean) as LeadReminderRecord[];
  }, [rawRows]);

  const [toast, setToast] = useState<ActiveToast | null>(null);
  const timersRef = useRef<number[]>([]);
  const dismissedRef = useRef(readDismissed());

  const showToast = useCallback(
    (r: LeadReminderRecord) => {
      if (dismissedRef.current.has(r.id)) return;
      setToast(r);
      window.dispatchEvent(new CustomEvent(ALARM_EVENT));
      if (pushEnabled) playReminderChime();
    },
    [pushEnabled]
  );

  const tryFire = useCallback(
    async (r: LeadReminderRecord) => {
      if (!user || !companyId) return;
      await patchLeadReminder(user, r.id, { companyId, action: "fire" });
      showToast(r);
    },
    [user, companyId, showToast]
  );

  useEffect(() => {
    if (!user) return;
    void processDueLeadReminders(user);
    const iv = window.setInterval(() => void processDueLeadReminders(user), 60_000);
    return () => window.clearInterval(iv);
  }, [user]);

  useEffect(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    const now = Date.now();
    for (const r of reminders) {
      const due = new Date(r.remindAt).getTime();
      if (r.notificationFired) {
        if (due <= now && !dismissedRef.current.has(r.id)) {
          showToast(r);
        }
        continue;
      }
      if (due <= now + 500) {
        void tryFire(r);
        continue;
      }
      const delay = Math.min(due - now, 24 * 60 * 60 * 1000);
      const tid = window.setTimeout(() => void tryFire(r), Math.max(0, delay));
      timersRef.current.push(tid);
    }
    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
    };
  }, [reminders, tryFire, showToast]);

  const dismissToast = (id: string) => {
    dismissedRef.current.add(id);
    writeDismissed(dismissedRef.current);
    setToast(null);
  };

  if (!toast || !user || !companyId) return null;

  const due = new Date(toast.remindAt);

  return (
    <div
      className={cn(
        "fixed top-16 right-3 z-[200] w-[min(100vw-1.5rem,22rem)] rounded-xl border-2 border-amber-400",
        "bg-amber-50 shadow-xl animate-in slide-in-from-top-2 duration-300"
      )}
      role="alert"
    >
      <div className="flex items-start gap-2 p-3">
        <AlarmClock className="h-6 w-6 shrink-0 text-amber-700 animate-pulse" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
            Připomínka – zavolat zákazníkovi
          </p>
          <p className="text-sm font-semibold text-slate-900">{toast.customerName}</p>
          <p className="text-xs text-slate-800">Poptávka: {toast.inquiryTitle}</p>
          <p className="text-xs text-slate-800">Čas: {formatRemindTimePrague(due)}</p>
          {toast.note ? (
            <p className="text-xs text-slate-700 whitespace-pre-wrap">Poznámka: {toast.note}</p>
          ) : null}
          <div className="flex flex-wrap gap-1.5 pt-2">
            <Button asChild size="sm" className="h-8 text-xs">
              <Link href={leadReminderOpenUrl(toast.leadKey)} onClick={() => dismissToast(toast.id)}>
                Otevřít poptávku
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() =>
                void patchLeadReminder(user, toast.id, { companyId, action: "snooze", minutes: 10 }).then(
                  () => dismissToast(toast.id)
                )
              }
            >
              Odložit 10 min
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() =>
                void patchLeadReminder(user, toast.id, { companyId, action: "snooze", minutes: 30 }).then(
                  () => dismissToast(toast.id)
                )
              }
            >
              Odložit 30 min
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 text-xs"
              onClick={() =>
                void patchLeadReminder(user, toast.id, { companyId, action: "done" }).then(() =>
                  dismissToast(toast.id)
                )
              }
            >
              Hotovo
            </Button>
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-slate-600 hover:bg-amber-100"
          aria-label="Zavřít"
          onClick={() => dismissToast(toast.id)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export { ALARM_EVENT };
