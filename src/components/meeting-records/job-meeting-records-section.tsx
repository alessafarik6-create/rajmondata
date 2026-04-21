"use client";

import React, { useMemo, useState } from "react";
import type { Firestore } from "firebase/firestore";
import { collection, doc, orderBy, query, where, writeBatch } from "firebase/firestore";
import type { User } from "firebase/auth";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { CalendarClock, Pencil, Trash2, Plus } from "lucide-react";
import { formatDashboardActivityTime } from "@/components/portal/dashboard-activity-section";
import { MeetingRecordFormDialog } from "@/components/meeting-records/meeting-record-form-dialog";
import type { ActivityActorProfile } from "@/lib/activity-log";
import { logActivitySafe } from "@/lib/activity-log";
import { MEETING_RECORD_INTERNAL_DOC_ID } from "@/lib/meeting-records-types";

type JobOption = { id: string; name: string };

type MeetingRow = {
  id: string;
  title?: string;
  meetingNotes?: string;
  meetingAt?: unknown;
  sharedWithCustomer?: boolean;
  createdByName?: string;
  createdBy?: string;
};

export function JobMeetingRecordsSection(props: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobName: string;
  jobs: JobOption[];
  user: User;
  profile: ActivityActorProfile | null | undefined;
  canEdit: boolean;
}) {
  const { firestore, companyId, jobId, jobName, jobs, user, profile, canEdit } = props;
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "internal" | "shared">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const q = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId) return null;
    return query(
      collection(firestore, "companies", companyId, "meetingRecords"),
      where("jobId", "==", jobId),
      orderBy("meetingAt", "desc")
    );
  }, [firestore, companyId, jobId]);

  const { data: raw, isLoading } = useCollection(q);

  const rows = useMemo(() => {
    const list = Array.isArray(raw) ? (raw as MeetingRow[]) : [];
    return list.filter((r) => r && typeof r.id === "string");
  }, [raw]);

  const filtered = useMemo(() => {
    if (filter === "internal") return rows.filter((r) => r.sharedWithCustomer !== true);
    if (filter === "shared") return rows.filter((r) => r.sharedWithCustomer === true);
    return rows;
  }, [rows, filter]);

  const openCreate = () => {
    setEditId(null);
    setFormOpen(true);
  };

  const openEdit = (id: string) => {
    setEditId(id);
    setFormOpen(true);
  };

  const runDelete = async () => {
    if (!deleteId || !canEdit) return;
    setDeleting(true);
    try {
      const batch = writeBatch(firestore);
      const pref = doc(firestore, "companies", companyId, "meetingRecords", deleteId);
      const iref = doc(
        firestore,
        "companies",
        companyId,
        "meetingRecords",
        deleteId,
        "internal",
        MEETING_RECORD_INTERNAL_DOC_ID
      );
      batch.delete(iref);
      batch.delete(pref);
      await batch.commit();
      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "meeting_record_deleted",
        actionLabel: "Smazán záznam ze schůzky",
        entityType: "meeting_record",
        entityId: deleteId,
        entityName: jobName,
        sourceModule: "schuzky",
        route: `/portal/jobs/${jobId}`,
      });
      toast({ title: "Záznam byl odstraněn" });
      setDeleteId(null);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="border-slate-200 bg-white">
        <CardHeader className="flex flex-col gap-3 border-b border-slate-100 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-lg text-slate-900">
            <CalendarClock className="h-5 w-5 text-primary" />
            Záznamy ze schůzek
          </CardTitle>
          {canEdit ? (
            <Button type="button" size="sm" className="gap-1" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Nový záznam
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList className="h-auto flex-wrap gap-1">
              <TabsTrigger value="all" className="text-xs sm:text-sm">
                Všechny
              </TabsTrigger>
              <TabsTrigger value="internal" className="text-xs sm:text-sm">
                Interní
              </TabsTrigger>
              <TabsTrigger value="shared" className="text-xs sm:text-sm">
                Odeslané zákazníkovi
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {isLoading ? (
            <p className="text-sm text-slate-600">Načítání…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-600">Zatím žádné záznamy u této zakázky.</p>
          ) : (
            <ul className="space-y-3">
              {filtered.map((r) => {
                const preview = String(r.meetingNotes || "").trim().replace(/\s+/g, " ");
                const short =
                  preview.length > 160 ? `${preview.slice(0, 160)}…` : preview || "—";
                return (
                  <li
                    key={r.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-slate-900">{r.title || "Schůzka"}</p>
                        <p className="text-xs text-slate-600">
                          {formatDashboardActivityTime(r.meetingAt)} ·{" "}
                          {r.createdByName || r.createdBy || "—"}
                        </p>
                        <p className="text-sm text-slate-700 line-clamp-2">{short}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {r.sharedWithCustomer ? (
                          <Badge variant="outline" className="border-emerald-300 text-emerald-900">
                            U zákazníka
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Interní</Badge>
                        )}
                        {canEdit ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Upravit"
                              onClick={() => openEdit(r.id)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              aria-label="Smazat"
                              onClick={() => setDeleteId(r.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <MeetingRecordFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setEditId(null);
        }}
        firestore={firestore}
        companyId={companyId}
        user={user}
        profile={profile}
        jobs={jobs}
        editRecordId={editId}
        defaultJobId={jobId}
        onSaved={() => {}}
      />

      <AlertDialog open={deleteId != null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat záznam ze schůzky?</AlertDialogTitle>
            <AlertDialogDescription>
              Tuto akci nelze vrátit. Interní poznámky i veřejná část budou odstraněny.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runDelete()} disabled={deleting}>
              {deleting ? "Mažu…" : "Smazat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
