"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, writeBatch } from "firebase/firestore";
import {
  useUser,
  useFirestore,
  useMemoFirebase,
  useDoc,
  useCollection,
  useCompany,
} from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { ArrowLeft, CalendarClock, FileDown, Loader2, Mail, Pencil, Trash2 } from "lucide-react";
import { formatDashboardActivityTime } from "@/components/portal/dashboard-activity-section";
import { MeetingRecordFormDialog } from "@/components/meeting-records/meeting-record-form-dialog";
import { MeetingRecordEmailDialog } from "@/components/meeting-records/meeting-record-email-dialog";
import { downloadMeetingRecordPdf } from "@/lib/meeting-records-client-api";
import type { ActivityActorProfile } from "@/lib/activity-log";
import { logActivitySafe } from "@/lib/activity-log";
import {
  MEETING_RECORD_INTERNAL_DOC_ID,
  resolveAssignmentStatus,
  resolveMeetingTitle,
  resolveSentToCustomer,
  type MeetingRecordPublicRow,
} from "@/lib/meeting-records-types";
import {
  staffCanEditMeetingRecords,
  staffCanViewMeetingRecords,
} from "@/lib/meeting-records-access";

export default function MeetingRecordDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();
  const { userProfile, profileLoading, companyId: companyIdFromHook } = useCompany();

  const recordIdRaw = params?.recordId;
  const recordId = Array.isArray(recordIdRaw) ? recordIdRaw[0] : recordIdRaw;
  const recordIdStr = typeof recordId === "string" ? recordId.trim() : "";

  const companyId = companyIdFromHook ?? (userProfile as { companyId?: string })?.companyId;

  const employeeSelfRef = useMemoFirebase(
    () =>
      firestore &&
      companyId &&
      (userProfile as { employeeId?: string })?.employeeId &&
      (userProfile as { role?: string })?.role === "employee"
        ? doc(
            firestore,
            "companies",
            companyId,
            "employees",
            String((userProfile as { employeeId?: string }).employeeId)
          )
        : null,
    [firestore, companyId, userProfile]
  );
  const { data: employeeSelf } = useDoc(employeeSelfRef);

  const canView = useMemo(
    () =>
      staffCanViewMeetingRecords(
        userProfile as { role?: string; globalRoles?: string[] },
        employeeSelf as { canAccessMeetingNotes?: boolean } | null
      ),
    [userProfile, employeeSelf]
  );

  const canEdit = useMemo(
    () =>
      staffCanEditMeetingRecords(
        userProfile as { role?: string; globalRoles?: string[] },
        employeeSelf as { canAccessMeetingNotes?: boolean } | null
      ),
    [userProfile, employeeSelf]
  );

  const recordRef = useMemoFirebase(
    () =>
      firestore && companyId && recordIdStr
        ? doc(firestore, "companies", companyId, "meetingRecords", recordIdStr)
        : null,
    [firestore, companyId, recordIdStr]
  );
  const { data: record, isLoading } = useDoc(recordRef);

  const internalRef = useMemoFirebase(
    () =>
      firestore && companyId && recordIdStr && canView
        ? doc(
            firestore,
            "companies",
            companyId,
            "meetingRecords",
            recordIdStr,
            "internal",
            MEETING_RECORD_INTERNAL_DOC_ID
          )
        : null,
    [firestore, companyId, recordIdStr, canView]
  );
  const { data: internalRow } = useDoc(internalRef);

  const jobsCol = useMemoFirebase(
    () =>
      firestore && companyId ? collection(firestore, "companies", companyId, "jobs") : null,
    [firestore, companyId]
  );
  const { data: jobsRaw } = useCollection(jobsCol);
  const jobs = useMemo(() => {
    const list = Array.isArray(jobsRaw) ? jobsRaw : [];
    return list
      .map((j) => {
        const r = j as { id?: string; name?: string };
        if (!r?.id) return null;
        return { id: r.id, name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : r.id };
      })
      .filter((x): x is { id: string; name: string } => x != null);
  }, [jobsRaw]);

  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const row = record as MeetingRecordPublicRow | null | undefined;

  const jobEmailRef = useMemoFirebase(
    () =>
      firestore && companyId && row?.jobId && String(row.jobId).trim()
        ? doc(firestore, "companies", companyId, "jobs", String(row.jobId).trim())
        : null,
    [firestore, companyId, row?.jobId]
  );
  const { data: jobForEmail } = useDoc(jobEmailRef);

  const defaultCustomerEmail = useMemo(() => {
    const j = jobForEmail as { customerEmail?: string } | null | undefined;
    return typeof j?.customerEmail === "string" ? j.customerEmail.trim() : "";
  }, [jobForEmail]);

  const title = row ? resolveMeetingTitle(row) || "Schůzka" : "—";
  const sent = row ? resolveSentToCustomer(row) : false;
  const assigned = row ? resolveAssignmentStatus(row) === "assigned" : false;

  useEffect(() => {
    if ((userProfile as { role?: string })?.role === "customer") {
      router.replace("/portal/customer");
    }
  }, [userProfile, router]);

  const runDelete = async () => {
    if (!canEdit || !firestore || !companyId || !recordIdStr || !user) return;
    setDeleting(true);
    try {
      const batch = writeBatch(firestore);
      const pref = doc(firestore, "companies", companyId, "meetingRecords", recordIdStr);
      const iref = doc(
        firestore,
        "companies",
        companyId,
        "meetingRecords",
        recordIdStr,
        "internal",
        MEETING_RECORD_INTERNAL_DOC_ID
      );
      batch.delete(iref);
      batch.delete(pref);
      await batch.commit();
      logActivitySafe(firestore, companyId, user, userProfile as ActivityActorProfile, {
        actionType: "meeting_record_deleted",
        actionLabel: "Smazán záznam ze schůzky",
        entityType: "meeting_record",
        entityId: recordIdStr,
        entityName: title,
        sourceModule: "schuzky",
        route: `/portal/meeting-records/${recordIdStr}`,
      });
      toast({ title: "Záznam byl odstraněn" });
      router.replace("/portal/meeting-records");
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  if (!user || profileLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if ((userProfile as { role?: string })?.role === "customer") {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canView || !companyId || !firestore) {
    return (
      <div className="mx-auto max-w-lg px-3 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Přístup</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Nemáte oprávnění k tomuto záznamu.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!recordIdStr) {
    return (
      <div className="mx-auto max-w-lg px-3 py-10 text-sm text-muted-foreground">
        Neplatný odkaz.
      </div>
    );
  }

  if (!isLoading && !row) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-3 py-10">
        <p className="text-sm text-muted-foreground">Záznam neexistuje nebo byl odstraněn.</p>
        <Button type="button" variant="outline" asChild>
          <Link href="/portal/meeting-records">Zpět na evidenci</Link>
        </Button>
      </div>
    );
  }

  if (isLoading || !row) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const internalNotes =
    typeof (internalRow as { internalNotes?: string } | null)?.internalNotes === "string"
      ? (internalRow as { internalNotes: string }).internalNotes
      : "";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-3 py-6 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="gap-1" asChild>
          <Link href="/portal/meeting-records">
            <ArrowLeft className="h-4 w-4" />
            Evidence
          </Link>
        </Button>
        {row.jobId && typeof row.jobId === "string" && row.jobId.trim() ? (
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link href={`/portal/jobs/${row.jobId.trim()}`}>Otevřít zakázku</Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b border-slate-100 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl text-slate-900">
              <CalendarClock className="h-6 w-6 text-primary" />
              {title}
            </CardTitle>
            <p className="text-sm text-slate-600">
              {formatDashboardActivityTime(row.meetingAt)} · Vytvořil:{" "}
              {row.createdByName || row.createdBy || "—"}
            </p>
            <p className="text-xs text-slate-500">
              Naposledy upraveno: {formatDashboardActivityTime(row.updatedAt)}
            </p>
            {Array.isArray(row.sentToEmails) && row.sentToEmails.length > 0 ? (
              <p className="text-xs text-slate-600">
                Odesláno e-mailem: {formatDashboardActivityTime(row.sentAt)} — komu:{" "}
                {row.sentToEmails.join(", ")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {sent ? (
              <Badge variant="outline" className="border-emerald-300 text-emerald-900">
                Odesláno zákazníkovi
              </Badge>
            ) : (
              <Badge variant="secondary">Interní</Badge>
            )}
            {assigned ? (
              <Badge variant="outline">Přiřazeno k zakázce</Badge>
            ) : (
              <Badge variant="outline" className="border-amber-200 text-amber-900">
                Nepřiřazeno k zakázce
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Zákazník</p>
              <p className="text-slate-900">{row.customerName?.trim() || "—"}</p>
              <p className="text-xs text-slate-600">
                CRM ID: {typeof row.customerId === "string" && row.customerId.trim() ? row.customerId : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Zakázka</p>
              <p className="text-slate-900">
                {assigned && row.jobName ? row.jobName : assigned ? row.jobId : "—"}
              </p>
            </div>
          </div>

          {row.place ? (
            <div>
              <p className="text-xs font-medium text-slate-500">Místo</p>
              <p className="text-slate-800">{row.place}</p>
            </div>
          ) : null}

          {row.participants ? (
            <div>
              <p className="text-xs font-medium text-slate-500">Účastníci</p>
              <p className="whitespace-pre-wrap text-slate-800">{row.participants}</p>
            </div>
          ) : null}

          <Separator />

          <div>
            <p className="text-xs font-medium text-slate-500">Poznámky</p>
            <p className="mt-1 whitespace-pre-wrap text-slate-900">{row.meetingNotes || "—"}</p>
          </div>

          {row.nextSteps ? (
            <div>
              <p className="text-xs font-medium text-slate-500">Další kroky</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-900">{row.nextSteps}</p>
            </div>
          ) : null}

          {internalNotes.trim() ? (
            <div className="rounded-md border border-amber-200 bg-amber-50/50 p-4">
              <p className="text-xs font-medium text-amber-900">Interní poznámka</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-900">{internalNotes}</p>
            </div>
          ) : null}

          {canView ? (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                className="gap-1"
                disabled={pdfBusy || !user}
                onClick={() => {
                  if (!user || !companyId) return;
                  setPdfBusy(true);
                  void downloadMeetingRecordPdf(user, companyId, recordIdStr, title)
                    .then(() => {
                      toast({ title: "PDF je stažené" });
                    })
                    .catch((err: unknown) => {
                      toast({
                        variant: "destructive",
                        title: "Export PDF se nezdařil",
                        description: err instanceof Error ? err.message : "Zkuste to znovu.",
                      });
                    })
                    .finally(() => setPdfBusy(false));
                }}
              >
                <FileDown className="h-4 w-4" />
                {pdfBusy ? "Generuji…" : "Export PDF"}
              </Button>
            </div>
          ) : null}

          {canEdit ? (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="button" className="gap-1" onClick={() => setFormOpen(true)}>
                <Pencil className="h-4 w-4" />
                Upravit / přiřadit zakázku
              </Button>
              <Button type="button" variant="outline" className="gap-1" onClick={() => setEmailOpen(true)}>
                <Mail className="h-4 w-4" />
                Odeslat e-mailem
              </Button>
              <Button type="button" variant="destructive" className="gap-1" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" />
                Smazat
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {user ? (
        <MeetingRecordFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          firestore={firestore}
          companyId={companyId}
          user={user}
          profile={userProfile as ActivityActorProfile | null}
          jobs={jobs}
          editRecordId={recordIdStr}
          onSaved={() => setFormOpen(false)}
        />
      ) : null}

      {user && companyId && firestore ? (
        <MeetingRecordEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          firestore={firestore}
          companyId={companyId}
          recordId={recordIdStr}
          recordTitle={title}
          jobId={typeof row.jobId === "string" ? row.jobId : null}
          user={user}
          defaultTo={defaultCustomerEmail || undefined}
        />
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
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
    </div>
  );
}
