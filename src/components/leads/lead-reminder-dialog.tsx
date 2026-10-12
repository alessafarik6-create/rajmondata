"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlarmClock, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { User } from "firebase/auth";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import {
  pragueTodayYmd,
  resolveLeadReminderQuickPreset,
  type LeadReminderQuickPresetId,
} from "@/lib/leads/lead-reminder-datetime";
import { createLeadReminder } from "@/lib/leads/lead-reminder-client";
import { stableImportLeadDocumentId } from "@/lib/import-lead-keys";
import { resolveEffectiveInquiryType } from "@/lib/leads/lead-inquiry-type";
import { cn } from "@/lib/utils";

export type LeadReminderAssignee = {
  authUserId: string;
  label: string;
};

const QUICK: { id: LeadReminderQuickPresetId; label: string }[] = [
  { id: "15m", label: "Za 15 minut" },
  { id: "30m", label: "Za 30 minut" },
  { id: "1h", label: "Za hodinu" },
  { id: "today_11", label: "Dnes v 11:00" },
  { id: "tomorrow_9", label: "Zítra v 9:00" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadImportRow | null;
  overlayTyp?: { typ?: string; inquiryTypeManual?: boolean; tagId?: string | null };
  companyId: string;
  user: User;
  assignees: LeadReminderAssignee[];
  canAssignOthers: boolean;
  onCreated?: () => void;
};

export function LeadReminderDialog({
  open,
  onOpenChange,
  lead,
  overlayTyp,
  companyId,
  user,
  assignees,
  canAssignOthers,
  onCreated,
}: Props) {
  const { toast } = useToast();
  const [dateYmd, setDateYmd] = useState("");
  const [hour, setHour] = useState("11");
  const [minute, setMinute] = useState("0");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDateYmd(pragueTodayYmd());
    setHour(String(new Date().getHours()).padStart(2, "0"));
    setMinute("0");
    setAssignedUserId(user.uid);
    setNote("");
  }, [open, user.uid]);

  const assigneeOptions = useMemo(() => {
    const list = [...assignees];
    if (!list.some((a) => a.authUserId === user.uid)) {
      list.unshift({ authUserId: user.uid, label: "Já" });
    }
    return list;
  }, [assignees, user.uid]);

  const applyQuick = (id: LeadReminderQuickPresetId) => {
    const d = resolveLeadReminderQuickPreset(id);
    setDateYmd(format(d, "yyyy-MM-dd"));
    setHour(format(d, "HH"));
    setMinute(format(d, "mm"));
  };

  const handleSave = async () => {
    if (!lead) return;
    setSaving(true);
    try {
      const leadKey = stableImportLeadDocumentId(lead);
      const inquiryTitle = resolveEffectiveInquiryType(lead, overlayTyp);
      const customerName = String(lead.jmeno ?? "").trim() || "—";
      const res = await createLeadReminder(user, {
        companyId,
        leadKey,
        importLeadId: lead.id,
        customerName,
        inquiryTitle,
        assignedUserId: canAssignOthers ? assignedUserId : user.uid,
        note,
        dateYmd,
        hour: parseInt(hour, 10) || 0,
        minute: parseInt(minute, 10) || 0,
      });
      if (!res.ok) {
        toast({ variant: "destructive", title: res.error ?? "Uložení selhalo." });
        return;
      }
      toast({ title: "Budík nastaven", description: "Připomenutí je uložené v systému." });
      onCreated?.();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white border-slate-200 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlarmClock className="h-5 w-5 text-primary" />
            Připomenout
          </DialogTitle>
          <DialogDescription>
            Upozornění se zobrazí v zvonku a v pravém horním rohu portálu v nastavený čas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <Button
                key={q.id}
                type="button"
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => applyQuick(q.id)}
              >
                {q.label}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-date">Datum připomenutí</Label>
            <Input
              id="rem-date"
              type="date"
              value={dateYmd}
              onChange={(e) => setDateYmd(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Hodina</Label>
              <select
                className={NATIVE_SELECT_CLASS}
                value={hour}
                onChange={(e) => setHour(e.target.value)}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={String(i)}>
                    {String(i).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Minuta</Label>
              <select
                className={NATIVE_SELECT_CLASS}
                value={minute}
                onChange={(e) => setMinute(e.target.value)}
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                  <option key={m} value={String(m)}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Komu připomenout</Label>
            <select
              className={cn(NATIVE_SELECT_CLASS, !canAssignOthers && "opacity-80")}
              value={canAssignOthers ? assignedUserId : user.uid}
              disabled={!canAssignOthers}
              onChange={(e) => setAssignedUserId(e.target.value)}
            >
              {assigneeOptions.map((a) => (
                <option key={a.authUserId} value={a.authUserId}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem-note">Text připomínky</Label>
            <Textarea
              id="rem-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Např. Zavolat zákazníkovi ohledně nabídky"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving || !lead}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Nastavit budík
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
