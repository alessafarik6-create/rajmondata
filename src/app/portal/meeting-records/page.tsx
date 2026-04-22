"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, doc, limit, orderBy, query } from "firebase/firestore";
import {
  useUser,
  useFirestore,
  useMemoFirebase,
  useCollection,
  useDoc,
  useCompany,
} from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarClock, ExternalLink, FileDown, Mail, Pencil, Plus } from "lucide-react";
import { formatDashboardActivityTime } from "@/components/portal/dashboard-activity-section";
import { MeetingRecordFormDialog } from "@/components/meeting-records/meeting-record-form-dialog";
import { MeetingRecordEmailDialog } from "@/components/meeting-records/meeting-record-email-dialog";
import { useToast } from "@/hooks/use-toast";
import { downloadMeetingRecordPdf } from "@/lib/meeting-records-client-api";
import type { ActivityActorProfile } from "@/lib/activity-log";
import {
  resolveAssignmentStatus,
  resolveMeetingTitle,
  resolveSentToCustomer,
} from "@/lib/meeting-records-types";
import {
  staffCanEditMeetingRecords,
  staffCanViewMeetingRecords,
} from "@/lib/meeting-records-access";

type RegistryFilter = "all" | "unassigned" | "assigned" | "shared" | "internal";

type MeetingRow = {
  id: string;
  title?: string;
  meetingTitle?: string | null;
  meetingNotes?: string;
  meetingAt?: unknown;
  jobId?: string | null;
  jobName?: string | null;
  customerName?: string | null;
  sharedWithCustomer?: boolean;
  sentToCustomer?: boolean;
  isSharedWithCustomer?: boolean;
  visibility?: string | null;
  sentAt?: unknown;
  sentToEmails?: string[];
  createdByName?: string | null;
  createdBy?: string | null;
};

function matchesRegistryFilter(row: MeetingRow, f: RegistryFilter): boolean {
  const sent = resolveSentToCustomer(row);
  const jid = typeof row.jobId === "string" && row.jobId.trim().length > 0;
  if (f === "unassigned") return !jid;
  if (f === "assigned") return jid;
  if (f === "shared") return sent;
  if (f === "internal") return !sent;
  return true;
}

export default function MeetingRecordsRegistryPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();
  const {
    userProfile,
    profileLoading,
    companyId: companyIdFromHook,
  } = useCompany();

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

  const [filter, setFilter] = useState<RegistryFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [emailRecordId, setEmailRecordId] = useState<string | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);

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

  const recordsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "meetingRecords"),
      orderBy("meetingAt", "desc"),
      limit(400)
    );
  }, [firestore, companyId]);

  const { data: recordsRaw, isLoading } = useCollection(recordsQuery);

  const rows = useMemo(() => {
    const list = Array.isArray(recordsRaw) ? (recordsRaw as MeetingRow[]) : [];
    return list.filter((r) => r && typeof r.id === "string");
  }, [recordsRaw]);

  const filtered = useMemo(
    () => rows.filter((r) => matchesRegistryFilter(r, filter)),
    [rows, filter]
  );

  const emailRow = useMemo(
    () => (emailRecordId ? rows.find((r) => r.id === emailRecordId) ?? null : null),
    [rows, emailRecordId]
  );

  if (!user || profileLoading) {
    return (
      <div className="mx-auto max-w-5xl px-3 py-10 text-sm text-muted-foreground">Načítání…</div>
    );
  }

  if (!canView || !companyId || !firestore) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-3 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Přístup</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Nemáte oprávnění k evidenci záznamů ze schůzek.
          </CardContent>
        </Card>
        <Button type="button" variant="outline" onClick={() => router.push("/portal/dashboard")}>
          Zpět na přehled
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Záznamy ze schůzek</h1>
          <p className="text-sm text-slate-600">
            Přehled všech záznamů včetně nepřiřazených. Úpravy a přiřazení zakázky jsou vždy u stejného
            dokumentu — neduplikují se.
          </p>
        </div>
        {canEdit ? (
          <Button
            type="button"
            className="gap-2 self-start"
            onClick={() => {
              setEditId(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Nový záznam
          </Button>
        ) : null}
      </div>

      <Card className="border-slate-200">
        <CardHeader className="space-y-3 border-b border-slate-100 pb-4">
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <CalendarClock className="h-5 w-5 text-primary" />
            Filtr
          </CardTitle>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as RegistryFilter)}>
            <TabsList className="h-auto flex-wrap gap-1">
              <TabsTrigger value="all" className="text-xs sm:text-sm">
                Všechny
              </TabsTrigger>
              <TabsTrigger value="unassigned" className="text-xs sm:text-sm">
                Nepřiřazené
              </TabsTrigger>
              <TabsTrigger value="assigned" className="text-xs sm:text-sm">
                Přiřazené k zakázce
              </TabsTrigger>
              <TabsTrigger value="shared" className="text-xs sm:text-sm">
                Odeslané zákazníkovi
              </TabsTrigger>
              <TabsTrigger value="internal" className="text-xs sm:text-sm">
                Interní
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-slate-600">Načítání…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-600">Žádné záznamy v tomto filtru.</p>
          ) : (
            <ul className="space-y-3">
              {filtered.map((r) => {
                const title = resolveMeetingTitle(r) || "Schůzka";
                const sent = resolveSentToCustomer(r);
                const assigned = resolveAssignmentStatus(r) === "assigned";
                const preview = String(r.meetingNotes || "")
                  .trim()
                  .replace(/\s+/g, " ");
                const short =
                  preview.length > 140 ? `${preview.slice(0, 140)}…` : preview || "—";
                return (
                  <li
                    key={r.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-slate-900">{title}</p>
                        <p className="text-xs text-slate-600">
                          {formatDashboardActivityTime(r.meetingAt)} ·{" "}
                          {r.createdByName || r.createdBy || "—"}
                        </p>
                        <p className="text-xs text-slate-600">
                          {assigned ? (
                            <>
                              Zakázka:{" "}
                              <span className="font-medium text-slate-800">
                                {r.jobName || r.jobId || "—"}
                              </span>
                            </>
                          ) : (
                            <span className="font-medium text-amber-800">Nepřiřazeno k zakázce</span>
                          )}
                          {r.customerName ? (
                            <>
                              {" "}
                              · Zákazník: {r.customerName}
                            </>
                          ) : null}
                        </p>
                        <p className="text-sm text-slate-700 line-clamp-2">{short}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {sent ? (
                          <Badge variant="outline" className="border-emerald-300 text-emerald-900">
                            Odesláno zákazníkovi
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Interní</Badge>
                        )}
                        <Button type="button" variant="outline" size="sm" className="gap-1" asChild>
                          <Link href={`/portal/meeting-records/${r.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                            Detail
                          </Link>
                        </Button>
                        {canEdit ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => {
                              setEditId(r.id);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Upravit
                          </Button>
                        ) : null}
                        {canView ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            disabled={pdfBusyId === r.id}
                            onClick={() => {
                              if (!user || !companyId) return;
                              setPdfBusyId(r.id);
                              void downloadMeetingRecordPdf(user, companyId, r.id, title)
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
                                .finally(() => setPdfBusyId(null));
                            }}
                          >
                            <FileDown className="h-3.5 w-3.5" />
                            Export PDF
                          </Button>
                        ) : null}
                        {canEdit ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => setEmailRecordId(r.id)}
                          >
                            <Mail className="h-3.5 w-3.5" />
                            Odeslat e-mailem
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {Array.isArray(r.sentToEmails) && r.sentToEmails.length > 0 ? (
                      <p className="text-xs text-slate-600 border-t border-slate-100 pt-2 mt-1">
                        Odesláno e-mailem: {formatDashboardActivityTime(r.sentAt)} — komu:{" "}
                        {r.sentToEmails.join(", ")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {user ? (
        <MeetingRecordFormDialog
          open={formOpen}
          onOpenChange={(o) => {
            setFormOpen(o);
            if (!o) setEditId(null);
          }}
          firestore={firestore}
          companyId={companyId}
          user={user}
          profile={userProfile as ActivityActorProfile | null}
          jobs={jobs}
          editRecordId={editId}
          onSaved={() => {}}
        />
      ) : null}

      {user && emailRecordId && emailRow && companyId ? (
        <MeetingRecordEmailDialog
          open={!!emailRecordId}
          onOpenChange={(o) => {
            if (!o) setEmailRecordId(null);
          }}
          firestore={firestore}
          companyId={companyId}
          recordId={emailRecordId}
          recordTitle={resolveMeetingTitle(emailRow) || "Schůzka"}
          jobId={typeof emailRow.jobId === "string" ? emailRow.jobId : null}
          user={user}
          onSent={() => {}}
        />
      ) : null}
    </div>
  );
}
