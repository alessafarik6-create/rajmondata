"use client";

import React, { useMemo, useState } from "react";
import { AlarmClock, Check, Clock, Loader2, Trash2 } from "lucide-react";
import type { User } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import { format } from "date-fns";
import type { LeadReminderRecord } from "@/lib/leads/lead-reminder-types";
import { formatRemindAtPrague } from "@/lib/leads/lead-reminder-datetime";
import {
  deleteLeadReminder,
  patchLeadReminder,
} from "@/lib/leads/lead-reminder-client";
import { cn } from "@/lib/utils";

type Props = {
  leadKey: string;
  companyId: string;
  user: User;
  reminders: LeadReminderRecord[];
  canWrite: boolean;
  currentUserId: string;
  onMutated?: () => void;
  onOpenReminderDialog?: () => void;
};

export function LeadRemindersSection({
  leadKey,
  companyId,
  user,
  reminders,
  canWrite,
  currentUserId,
  onMutated,
  onOpenReminderDialog,
}: Props) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editHour, setEditHour] = useState("9");
  const [editMinute, setEditMinute] = useState("0");

  const forLead = useMemo(
    () =>
      reminders
        .filter((r) => r.leadKey === leadKey)
        .sort((a, b) => new Date(b.remindAt).getTime() - new Date(a.remindAt).getTime()),
    [reminders, leadKey]
  );

  const active = forLead.filter((r) => r.status === "active");
  const done = forLead.filter((r) => r.status === "done");

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusyId(id);
    try {
      const res = await fn();
      if (!res.ok) {
        toast({ variant: "destructive", title: res.error ?? "Akce selhala." });
        return;
      }
      onMutated?.();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2 border-t border-slate-200/80 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-800">Připomínky</p>
        {canWrite ? (
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={onOpenReminderDialog}>
            <AlarmClock className="mr-1 h-3.5 w-3.5" />
            Nová připomínka
          </Button>
        ) : null}
      </div>

      {active.length === 0 && done.length === 0 ? (
        <p className="text-sm text-slate-600">Zatím žádné připomínky k této poptávce.</p>
      ) : null}

      <ul className="space-y-2">
        {active.map((r) => {
          const due = new Date(r.remindAt);
          const missed = due.getTime() < Date.now();
          const isMine = r.assignedUserId === currentUserId;
          return (
            <li
              key={r.id}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                missed ? "border-amber-300 bg-amber-50/80" : "border-slate-200 bg-white"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium text-slate-900 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                    {formatRemindAtPrague(due)}
                    {missed ? (
                      <span className="text-[10px] font-semibold uppercase text-amber-800">Zmeškané</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-700">
                    {r.assignedDisplayName ?? "Zaměstnanec"}
                    {!isMine ? " · přiřazeno jinému" : null}
                  </p>
                  {r.note ? <p className="text-xs text-slate-800 whitespace-pre-wrap">{r.note}</p> : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {isMine ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] px-2"
                        disabled={busyId === r.id}
                        onClick={() =>
                          void run(r.id, () =>
                            patchLeadReminder(user, r.id, { companyId, action: "snooze", minutes: 10 })
                          )
                        }
                      >
                        +10 min
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] px-2"
                        disabled={busyId === r.id}
                        onClick={() =>
                          void run(r.id, () =>
                            patchLeadReminder(user, r.id, { companyId, action: "snooze", minutes: 30 })
                          )
                        }
                      >
                        +30 min
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-[10px] px-2"
                        disabled={busyId === r.id}
                        onClick={() =>
                          void run(r.id, () => patchLeadReminder(user, r.id, { companyId, action: "done" }))
                        }
                      >
                        {busyId === r.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Check className="mr-0.5 h-3 w-3" />
                            Hotovo
                          </>
                        )}
                      </Button>
                    </>
                  ) : null}
                  {canWrite ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] px-2"
                        disabled={busyId === r.id}
                        onClick={() => {
                          const d = new Date(r.remindAt);
                          setEditingId(r.id);
                          setEditDate(format(d, "yyyy-MM-dd"));
                          setEditHour(format(d, "HH"));
                          setEditMinute(format(d, "mm"));
                        }}
                      >
                        Upravit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-700"
                        disabled={busyId === r.id}
                        onClick={() =>
                          void run(r.id, () => deleteLeadReminder(user, companyId, r.id))
                        }
                        aria-label="Smazat připomínku"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              {editingId === r.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-200/80 pt-2">
                  <Input
                    type="date"
                    className="h-8 w-[9.5rem] text-xs"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                  />
                  <select
                    className={cn(NATIVE_SELECT_CLASS, "h-8 w-16 text-xs")}
                    value={editHour}
                    onChange={(e) => setEditHour(e.target.value)}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={String(i).padStart(2, "0")}>
                        {String(i).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                  <select
                    className={cn(NATIVE_SELECT_CLASS, "h-8 w-16 text-xs")}
                    value={editMinute}
                    onChange={(e) => setEditMinute(e.target.value)}
                  >
                    {[0, 15, 30, 45].map((m) => (
                      <option key={m} value={String(m).padStart(2, "0")}>
                        {String(m).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={busyId === r.id}
                    onClick={() =>
                      void run(r.id, () =>
                        patchLeadReminder(user, r.id, {
                          companyId,
                          dateYmd: editDate,
                          hour: parseInt(editHour, 10) || 0,
                          minute: parseInt(editMinute, 10) || 0,
                        })
                      ).then(() => setEditingId(null))
                    }
                  >
                    Uložit termín
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => setEditingId(null)}
                  >
                    Zrušit
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {done.length > 0 ? (
        <details className="text-sm text-slate-700">
          <summary className="cursor-pointer text-xs font-medium text-slate-800">
            Vyřízené ({done.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {done.map((r) => (
              <li key={r.id} className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5 text-xs">
                <span className="line-through opacity-70">{formatRemindAtPrague(new Date(r.remindAt))}</span>
                {r.note ? ` — ${r.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
