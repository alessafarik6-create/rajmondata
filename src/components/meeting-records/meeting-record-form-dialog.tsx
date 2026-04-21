"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Firestore } from "firebase/firestore";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { logActivitySafe, type ActivityActorProfile } from "@/lib/activity-log";
import {
  MEETING_RECORD_INTERNAL_DOC_ID,
  resolveMeetingTitle,
  resolveSentToCustomer,
  type MeetingRecordPublicRow,
  type MeetingShareEvent,
} from "@/lib/meeting-records-types";

type JobOption = { id: string; name: string };

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function activityRouteForRecord(jobId: string | null, recordId: string): string {
  if (jobId) return `/portal/jobs/${jobId}`;
  return `/portal/meeting-records/${recordId}`;
}

export function MeetingRecordFormDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firestore: Firestore;
  companyId: string;
  user: User;
  profile: ActivityActorProfile | null | undefined;
  jobs: JobOption[];
  editRecordId?: string | null;
  defaultJobId?: string | null;
  onSaved?: () => void;
}) {
  const {
    open,
    onOpenChange,
    firestore,
    companyId,
    user,
    profile,
    jobs,
    editRecordId,
    defaultJobId,
    onSaved,
  } = props;
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [meetingAtLocal, setMeetingAtLocal] = useState(() => toDatetimeLocalValue(new Date()));
  const [place, setPlace] = useState("");
  const [participants, setParticipants] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [syncCustomerFromJob, setSyncCustomerFromJob] = useState(true);

  const jobById = useMemo(() => {
    const m = new Map<string, JobOption>();
    for (const j of jobs) m.set(j.id, j);
    return m;
  }, [jobs]);

  useEffect(() => {
    if (!open) return;
    if (editRecordId) return;
    setTitle("");
    setMeetingAtLocal(toDatetimeLocalValue(new Date()));
    setPlace("");
    setParticipants("");
    setJobId(defaultJobId?.trim() || "");
    setCustomerName("");
    setCustomerId("");
    setMeetingNotes("");
    setNextSteps("");
    setInternalNotes("");
    setSyncCustomerFromJob(true);
  }, [open, editRecordId, defaultJobId]);

  useEffect(() => {
    if (!open || !editRecordId || !firestore || !companyId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const pref = doc(firestore, "companies", companyId, "meetingRecords", editRecordId);
        const iref = doc(
          firestore,
          "companies",
          companyId,
          "meetingRecords",
          editRecordId,
          "internal",
          MEETING_RECORD_INTERNAL_DOC_ID
        );
        const [ps, is] = await Promise.all([getDoc(pref), getDoc(iref)]);
        if (cancelled) return;
        if (!ps.exists()) {
          toast({ variant: "destructive", title: "Záznam neexistuje." });
          return;
        }
        const d = ps.data() as MeetingRecordPublicRow;
        setTitle(resolveMeetingTitle(d));
        const ma = d.meetingAt as Timestamp | undefined;
        if (ma && typeof (ma as { toDate?: () => Date }).toDate === "function") {
          setMeetingAtLocal(toDatetimeLocalValue((ma as { toDate: () => Date }).toDate()));
        } else {
          setMeetingAtLocal(toDatetimeLocalValue(new Date()));
        }
        setPlace(String(d.place || ""));
        setParticipants(String(d.participants || ""));
        setJobId(typeof d.jobId === "string" && d.jobId.trim() ? d.jobId.trim() : "");
        setCustomerName(String(d.customerName || ""));
        setCustomerId(String(d.customerId || ""));
        setMeetingNotes(String(d.meetingNotes || ""));
        setNextSteps(String(d.nextSteps || ""));
        setInternalNotes(
          is.exists() ? String((is.data() as { internalNotes?: string }).internalNotes || "") : ""
        );
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: e instanceof Error ? e.message : "Načtení se nezdařilo.",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editRecordId, firestore, companyId, toast]);

  useEffect(() => {
    if (!open || editRecordId) return;
    if (!jobId) return;
    (async () => {
      try {
        const jref = doc(firestore, "companies", companyId, "jobs", jobId);
        const snap = await getDoc(jref);
        if (!snap.exists()) return;
        const j = snap.data() as Record<string, unknown>;
        const cn =
          typeof j.customerName === "string" && j.customerName.trim()
            ? j.customerName.trim()
            : null;
        const cid =
          typeof j.customerId === "string" && j.customerId.trim() ? j.customerId.trim() : null;
        if (cn) setCustomerName(cn);
        if (cid) setCustomerId(cid);
      } catch {
        /* ignore */
      }
    })();
  }, [open, editRecordId, jobId, firestore, companyId]);

  useEffect(() => {
    if (!open || !editRecordId || !jobId || !syncCustomerFromJob) return;
    (async () => {
      try {
        const jref = doc(firestore, "companies", companyId, "jobs", jobId);
        const snap = await getDoc(jref);
        if (!snap.exists()) return;
        const j = snap.data() as Record<string, unknown>;
        const cn =
          typeof j.customerName === "string" && j.customerName.trim()
            ? j.customerName.trim()
            : null;
        const cid =
          typeof j.customerId === "string" && j.customerId.trim() ? j.customerId.trim() : null;
        if (cn) setCustomerName(cn);
        if (cid) setCustomerId(cid);
      } catch {
        /* ignore */
      }
    })();
  }, [open, editRecordId, jobId, syncCustomerFromJob, firestore, companyId]);

  const actorName =
    profile?.displayName?.trim() ||
    user.displayName ||
    user.email?.split("@")[0] ||
    "Uživatel";

  const save = async (mode: "internal" | "customer") => {
    const titleTrim = title.trim();
    const notesTrim = meetingNotes.trim();
    if (!titleTrim && !notesTrim) {
      toast({
        variant: "destructive",
        title: "Vyplňte název schůzky nebo text poznámek.",
      });
      return;
    }
    const at = new Date(meetingAtLocal);
    if (Number.isNaN(at.getTime())) {
      toast({ variant: "destructive", title: "Neplatné datum a čas." });
      return;
    }
    const share = mode === "customer";
    const jId = jobId.trim() || null;
    const jName = jId ? (jobById.get(jId)?.name ?? jId) : null;

    let resolvedCustomerId = customerId.trim() || null;
    let resolvedCustomerName = customerName.trim() || null;
    if (jId && syncCustomerFromJob) {
      try {
        const jref = doc(firestore, "companies", companyId, "jobs", jId);
        const jobSnap = await getDoc(jref);
        if (jobSnap.exists()) {
          const j = jobSnap.data() as Record<string, unknown>;
          const cid =
            typeof j.customerId === "string" && j.customerId.trim() ? j.customerId.trim() : null;
          const cn =
            typeof j.customerName === "string" && j.customerName.trim() ? j.customerName.trim() : null;
          if (cid) resolvedCustomerId = cid;
          if (cn) resolvedCustomerName = cn;
        }
      } catch (syncErr) {
        console.error("[MeetingRecordFormDialog] syncCustomerFromJob on save failed", syncErr);
      }
    }

    if (share && !jId && !resolvedCustomerId) {
      toast({
        variant: "destructive",
        title: "Chybí vazba na zákazníka",
        description:
          "U záznamu bez zakázky vyplňte ID zákazníka (CRM), aby šel záznam ve zákaznickém portálu zobrazit.",
      });
      return;
    }

    const meetingTitleVal = titleTrim || null;
    const legacyTitleVal = titleTrim || (notesTrim ? notesTrim.slice(0, 240) : "");
    const assignmentStatus = jId ? "assigned" : "unassigned";
    const shared = share;
    const sent = share;

    setLoading(true);
    try {
      const batch = writeBatch(firestore);
      const col = collection(firestore, "companies", companyId, "meetingRecords");

      const makeShareEvent = (
        action: "shared_with_customer" | "resent_to_customer"
      ): MeetingShareEvent => ({
        /** Firestore: FieldValue.serverTimestamp() není povolen uvnitř prvků pole. */
        at: new Date().toISOString(),
        byUserId: user.uid,
        byDisplayName: actorName,
        action,
        audienceNote: jId
          ? "Zákaznický portál — zakázka"
          : resolvedCustomerId
            ? "Zákaznický portál — obecný záznam (profil)"
            : null,
      });

      if (editRecordId) {
        const pref = doc(firestore, "companies", companyId, "meetingRecords", editRecordId);
        const iref = doc(
          firestore,
          "companies",
          companyId,
          "meetingRecords",
          editRecordId,
          "internal",
          MEETING_RECORD_INTERNAL_DOC_ID
        );
        const prevSnap = await getDoc(pref);
        const prev = prevSnap.exists() ? (prevSnap.data() as MeetingRecordPublicRow) : null;
        const prevShared = prev ? resolveSentToCustomer(prev) : false;
        const nextHistory: MeetingShareEvent[] = Array.isArray(prev?.shareHistory)
          ? [...prev.shareHistory]
          : [];
        if (share) {
          if (!prevShared) nextHistory.push(makeShareEvent("shared_with_customer"));
          else nextHistory.push(makeShareEvent("resent_to_customer"));
        }
        const nextSent = share || prevShared;
        const publicUpdate = {
          title: legacyTitleVal,
          meetingTitle: meetingTitleVal,
          meetingAt: at,
          place: place.trim() || null,
          participants: participants.trim() || null,
          jobId: jId,
          jobName: jName,
          customerId: resolvedCustomerId,
          customerName: resolvedCustomerName || null,
          meetingNotes: notesTrim,
          nextSteps: nextSteps.trim() || null,
          sharedWithCustomer: nextSent,
          sentToCustomer: nextSent,
          assignmentStatus,
          shareHistory: nextHistory.slice(-40),
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        };
        console.log("[MeetingRecordFormDialog] save → batch.update (public)", {
          companyId,
          recordId: editRecordId,
          jobId: jId,
          jobName: jName,
          customerId: resolvedCustomerId,
          customerName: resolvedCustomerName,
          syncCustomerFromJob,
          shareHistoryLength: publicUpdate.shareHistory.length,
          lastShareAt:
            publicUpdate.shareHistory.length > 0
              ? publicUpdate.shareHistory[publicUpdate.shareHistory.length - 1]?.at
              : null,
          updatedAt: "serverTimestamp()",
        });
        batch.update(pref, publicUpdate);
        batch.set(
          iref,
          {
            internalNotes: internalNotes.trim(),
            updatedAt: serverTimestamp(),
            updatedBy: user.uid,
          },
          { merge: true }
        );
        await batch.commit();
        console.log("[MeetingRecordFormDialog] batch.commit OK (update)", {
          companyId,
          recordId: editRecordId,
        });
        logActivitySafe(firestore, companyId, user, profile, {
          actionType: "meeting_record_updated",
          actionLabel: `Upraven záznam ze schůzky: ${legacyTitleVal || notesTrim.slice(0, 80)}`,
          entityType: "meeting_record",
          entityId: editRecordId,
          entityName: legacyTitleVal || "Schůzka",
          details: share ? "Zpřístupněno / aktualizováno pro zákazníka." : "Uloženo interně.",
          sourceModule: "schuzky",
          route: activityRouteForRecord(jId, editRecordId),
        });
      } else {
        const pref = doc(col);
        const id = pref.id;
        const iref = doc(
          firestore,
          "companies",
          companyId,
          "meetingRecords",
          id,
          "internal",
          MEETING_RECORD_INTERNAL_DOC_ID
        );
        const publicCreate = {
          companyId,
          title: legacyTitleVal,
          meetingTitle: meetingTitleVal,
          meetingAt: at,
          place: place.trim() || null,
          participants: participants.trim() || null,
          jobId: jId,
          jobName: jName,
          customerId: resolvedCustomerId,
          customerName: resolvedCustomerName || null,
          meetingNotes: notesTrim,
          nextSteps: nextSteps.trim() || null,
          sharedWithCustomer: shared,
          sentToCustomer: sent,
          assignmentStatus,
          shareHistory: share ? [makeShareEvent("shared_with_customer")] : [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user.uid,
          createdByName: actorName,
          updatedBy: user.uid,
        };
        console.log("[MeetingRecordFormDialog] save → batch.set (public, new)", {
          companyId,
          newRecordId: id,
          jobId: jId,
          jobName: jName,
          customerId: resolvedCustomerId,
          customerName: resolvedCustomerName,
          syncCustomerFromJob,
          shareHistory: publicCreate.shareHistory,
          createdAt: "serverTimestamp()",
          updatedAt: "serverTimestamp()",
        });
        batch.set(pref, publicCreate);
        batch.set(iref, {
          internalNotes: internalNotes.trim(),
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });
        await batch.commit();
        console.log("[MeetingRecordFormDialog] batch.commit OK (create)", {
          companyId,
          recordId: id,
        });
        logActivitySafe(firestore, companyId, user, profile, {
          actionType: "meeting_record_created",
          actionLabel: `Nový záznam ze schůzky: ${legacyTitleVal || notesTrim.slice(0, 80)}`,
          entityType: "meeting_record",
          entityId: id,
          entityName: legacyTitleVal || "Schůzka",
          details: share ? "Vytvořeno a zpřístupněno zákazníkovi." : "Uloženo pouze interně.",
          sourceModule: "schuzky",
          route: activityRouteForRecord(jId, id),
        });
      }

      toast({
        title: share ? "Uloženo a zákazníkovi zpřístupněno" : "Uloženo interně",
        description: share
          ? jId
            ? "Veřejná část je u zakázky v zákaznickém portálu."
            : "Veřejná část je u zákazníka v profilu portálu (bez vazby na konkrétní zakázku)."
          : "Interní poznámky zůstávají jen u týmu.",
      });
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Uložení se nezdařilo.";
      console.error("[MeetingRecordFormDialog] save failed", e);
      toast({
        variant: "destructive",
        title: "Chyba při ukládání záznamu",
        description: msg,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,900px)] overflow-y-auto w-[min(100vw-1.5rem,520px)] sm:max-w-lg border border-slate-200 bg-white p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-slate-900">
            {editRecordId ? "Upravit záznam ze schůzky" : "Záznam ze schůzky"}
          </DialogTitle>
        </DialogHeader>

        {loading && editRecordId ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label htmlFor="mr-title">Název schůzky (volitelné, pokud máte poznámky)</Label>
              <Input
                id="mr-title"
                className="bg-white"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="např. Schůzka u zákazníka — zaměření"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mr-at">Datum a čas</Label>
                <Input
                  id="mr-at"
                  type="datetime-local"
                  className="bg-white"
                  value={meetingAtLocal}
                  onChange={(e) => setMeetingAtLocal(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mr-place">Místo</Label>
                <Input
                  id="mr-place"
                  className="bg-white"
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                  placeholder="Adresa / online odkaz"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mr-part">Účastníci</Label>
              <Textarea
                id="mr-part"
                className="bg-white min-h-[64px]"
                value={participants}
                onChange={(e) => setParticipants(e.target.value)}
                placeholder="Jména, role…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Zakázka</Label>
              <Select
                value={jobId || "__none__"}
                onValueChange={(v) => setJobId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Bez zakázky (obecný záznam)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Bez zakázky (obecný záznam)</SelectItem>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {jobId ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
                <div className="min-w-0 space-y-0.5">
                  <Label htmlFor="mr-sync-cust" className="text-xs font-medium">
                    Při změně zakázky převzít zákazníka z zakázky
                  </Label>
                  <p className="text-[10px] text-slate-600">
                    Vypněte, pokud chcete ručně držet jiného zákazníka.
                  </p>
                </div>
                <Switch
                  id="mr-sync-cust"
                  checked={syncCustomerFromJob}
                  onCheckedChange={setSyncCustomerFromJob}
                />
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mr-cname">Zákazník (zobrazení)</Label>
                <Input
                  id="mr-cname"
                  className="bg-white"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Předvyplní se z zakázky"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mr-cid">ID zákazníka (CRM)</Label>
                <Input
                  id="mr-cid"
                  className="bg-white"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  placeholder="Pro sdílení bez zakázky povinné"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mr-notes">Poznámky (veřejná část při sdílení)</Label>
              <Textarea
                id="mr-notes"
                className="bg-white min-h-[100px]"
                value={meetingNotes}
                onChange={(e) => setMeetingNotes(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mr-next">Úkoly / další kroky (veřejná část při sdílení)</Label>
              <Textarea
                id="mr-next"
                className="bg-white min-h-[80px]"
                value={nextSteps}
                onChange={(e) => setNextSteps(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50/50 p-3">
              <Label htmlFor="mr-int">Interní poznámka</Label>
              <Textarea
                id="mr-int"
                className="bg-white min-h-[72px]"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Neviditelné pro zákazníka"
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={() => void save("internal")}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Uložit jen interně
          </Button>
          <Button type="button" disabled={loading} onClick={() => void save("customer")}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Uložit a zpřístupnit zákazníkovi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
