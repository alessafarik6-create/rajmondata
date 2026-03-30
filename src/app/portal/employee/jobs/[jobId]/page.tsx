"use client";

import React, { useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCollection,
} from "@/firebase";
import { collection, doc } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ChevronLeft, MapPin, Calendar } from "lucide-react";
import { JobMediaSection } from "@/components/jobs/job-media-section";
import type { JobMemberPermissions } from "@/lib/job-employee-access";
import {
  DEFAULT_LIMITED_MEMBER_PERMISSIONS,
  memberPermissionsForAccessMode,
  filterFoldersForLimitedEmployee,
} from "@/lib/job-employee-access";
import { useAssignedWorklogJobs } from "@/hooks/use-assigned-worklog-jobs";
import { isJobIdAssigned } from "@/lib/assigned-jobs";

/** Bezpečná pole z dokumentu zakázky — žádné rozpočty / interní finance v UI. */
function safeJobOverviewFields(job: Record<string, unknown> | null | undefined) {
  if (!job) return null;
  return {
    name: typeof job.name === "string" ? job.name : "",
    description: typeof job.description === "string" ? job.description : "",
    status: typeof job.status === "string" ? job.status : "",
    startDate: typeof job.startDate === "string" ? job.startDate : "",
    endDate: typeof job.endDate === "string" ? job.endDate : "",
    customerAddress: typeof job.customerAddress === "string" ? job.customerAddress : "",
    measuring: typeof job.measuring === "string" ? job.measuring : "",
  };
}

export default function EmployeeJobDetailPage() {
  const params = useParams();
  const jobIdRaw = params?.jobId;
  const jobId = Array.isArray(jobIdRaw) ? jobIdRaw[0] : jobIdRaw;
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", employeeId)
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeDoc, isLoading: employeeLoading } = useDoc(employeeRef);

  const { assignedJobIds, jobsLoading } = useAssignedWorklogJobs(
    firestore,
    companyId,
    employeeDoc as Record<string, unknown> | undefined,
    employeeLoading,
    user?.uid,
    employeeId,
    "employeeSummary"
  );

  const accessAllowed = useMemo(() => {
    if (!jobId || typeof jobId !== "string") return false;
    return isJobIdAssigned(assignedJobIds, jobId);
  }, [jobId, assignedJobIds]);

  const summaryRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "employeeSummary",
            "summary"
          )
        : null,
    [firestore, companyId, jobId]
  );
  const { data: summary, isLoading: summaryLoading } = useDoc(summaryRef);

  const jobRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? doc(firestore, "companies", companyId, "jobs", jobId)
        : null,
    [firestore, companyId, jobId]
  );
  const { data: jobDoc } = useDoc(jobRef);

  const showLegacyPhotos =
    !!summary &&
    (summary as { legacyPhotosEmployeeVisible?: boolean })
      .legacyPhotosEmployeeVisible === true;

  const legacyPhotosColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId && showLegacyPhotos
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "photos"
          )
        : null,
    [firestore, companyId, jobId, showLegacyPhotos]
  );
  const { data: legacyPhotosData } = useCollection(legacyPhotosColRef);
  const legacyPhotos =
    showLegacyPhotos && legacyPhotosData != null
      ? legacyPhotosData
      : undefined;

  const memberRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId && employeeId
        ? doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "jobMembers",
            employeeId
          )
        : null,
    [firestore, companyId, jobId, employeeId]
  );
  const { data: memberDoc } = useDoc(memberRef);

  const memberPermissions: JobMemberPermissions = useMemo(() => {
    const raw = memberDoc?.jobPermissions as JobMemberPermissions | undefined;
    if (raw && typeof raw === "object") return raw;
    const mode = memberDoc?.accessMode as string | undefined;
    return memberPermissionsForAccessMode(
      mode === "full_internal" ? "full_internal" : "limited"
    );
  }, [memberDoc]);

  const effectivePermissions: JobMemberPermissions =
    memberDoc?.accessMode === "full_internal"
      ? memberPermissions
      : {
          ...DEFAULT_LIMITED_MEMBER_PERMISSIONS,
          ...memberPermissions,
          canViewPhotoFolders: memberPermissions.canViewPhotoFolders !== false,
        };

  /** V detailu zaměstnance nikdy nepropisujeme rozpočty / interní doklady — jen média. */
  const permissionsForMedia: JobMemberPermissions = {
    ...effectivePermissions,
    canViewBudgets: false,
    canViewDocuments: false,
  };

  const foldersColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(firestore, "companies", companyId, "jobs", jobId, "folders")
        : null,
    [firestore, companyId, jobId]
  );
  const { data: foldersRaw } = useCollection(foldersColRef);

  const visibleFolders = useMemo(() => {
    const list = (foldersRaw || []).filter(
      (f): f is Record<string, unknown> & { id: string } =>
        !!f && typeof (f as { id?: string }).id === "string"
    );
    return filterFoldersForLimitedEmployee(list, permissionsForMedia);
  }, [foldersRaw, permissionsForMedia]);

  const overview = useMemo(() => {
    const fromJob = safeJobOverviewFields(
      jobDoc as Record<string, unknown> | undefined
    );
    if (summary && typeof summary === "object") {
      const s = summary as Record<string, unknown>;
      const fromSummary = {
        name: (typeof s.name === "string" && s.name.trim()) || "",
        description: typeof s.description === "string" ? s.description : "",
        status: typeof s.status === "string" ? s.status : "",
        startDate: typeof s.startDate === "string" ? s.startDate : "",
        endDate: typeof s.endDate === "string" ? s.endDate : "",
        customerAddress:
          typeof s.customerAddress === "string" ? s.customerAddress : "",
        measuring: typeof s.measuring === "string" ? s.measuring : "",
        source: "summary" as const,
      };
      const summaryHasContent =
        !!fromSummary.name?.trim() ||
        !!fromSummary.description?.trim() ||
        !!fromSummary.customerAddress?.trim() ||
        !!fromSummary.measuring?.trim() ||
        !!fromSummary.status?.trim() ||
        !!fromSummary.startDate ||
        !!fromSummary.endDate;
      if (summaryHasContent) return fromSummary;
      if (fromJob) return { ...fromJob, source: "job" as const };
      return { ...fromSummary, source: "summary" as const };
    }
    if (!fromJob) return null;
    return { ...fromJob, source: "job" as const };
  }, [summary, jobDoc]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!jobId || typeof jobId !== "string") return;
    console.log("employee job route param", params);
    console.log("assignedJobIds", assignedJobIds);
    console.log("jobPermissions", memberDoc?.jobPermissions);
    console.log(
      "allowedFolderIds",
      (memberDoc?.jobPermissions as JobMemberPermissions | undefined)?.allowedFolderIds
    );
    console.log("visibleFolders", visibleFolders.map((f) => f.id));
  }, [params, jobId, assignedJobIds, memberDoc, visibleFolders]);

  if (!user) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (profileLoading || !profile) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId || !employeeId || !jobId || typeof jobId !== "string") {
    return (
      <Alert className="max-w-lg">
        <AlertTitle>Chybí údaje</AlertTitle>
        <AlertDescription>
          Nelze načíst zakázku. Zkuste to z portálu zaměstnance.
        </AlertDescription>
      </Alert>
    );
  }

  if (employeeLoading || jobsLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!accessAllowed) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-3 py-6 sm:px-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/jobs" className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Zpět na zakázky
          </Link>
        </Button>
        <Alert>
          <AlertTitle>Přístup zamítnut</AlertTitle>
          <AlertDescription>
            Tato zakázka vám není přiřazena, nebo k ní nemáte oprávnění.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const hasOverview =
    overview &&
    (overview.source === "job" ||
      !!overview.name?.trim() ||
      !!overview.description?.trim() ||
      !!overview.customerAddress?.trim() ||
      !!overview.measuring?.trim() ||
      !!overview.status?.trim() ||
      !!overview.startDate ||
      !!overview.endDate);

  const showDocEmpty =
    effectivePermissions.canViewPhotoFolders &&
    visibleFolders.length === 0 &&
    !showLegacyPhotos;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/jobs" className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Zakázky
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/employee" className="gap-1">
            Přehled
          </Link>
        </Button>
      </div>

      {summaryLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !hasOverview && !jobDoc ? (
        <Alert>
          <AlertTitle>Zakázku se nepodařilo načíst</AlertTitle>
          <AlertDescription>
            Zkuste obnovit stránku. Pokud problém přetrvá, kontaktujte administrátora.
          </AlertDescription>
        </Alert>
      ) : !hasOverview ? (
        <Alert>
          <AlertTitle>Údaje o zakázce nejsou k dispozici</AlertTitle>
          <AlertDescription>
            Požádejte administrátora o otevření zakázky v sekci Zakázky — doplní se bezpečný přehled
            pro zaměstnance.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {overview?.source === "job" ? (
            <p className="text-xs text-muted-foreground">
              Zobrazeny základní údaje z přiřazené zakázky. Plný přehled pro zaměstnance může doplnit
              administrátor při úpravě zakázky.
            </p>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                {overview?.name?.trim() || "Zakázka"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-800">
              {overview?.description ? (
                <p className="text-slate-700">{overview.description}</p>
              ) : null}
              <div className="flex flex-wrap gap-4 text-xs sm:text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Stav: <strong>{overview?.status || "—"}</strong>
                </span>
                {overview?.startDate ? (
                  <span>
                    Zahájení: <strong>{overview.startDate}</strong>
                  </span>
                ) : null}
                {overview?.endDate ? (
                  <span>
                    Dokončení: <strong>{overview.endDate}</strong>
                  </span>
                ) : null}
              </div>
              {overview?.customerAddress ? (
                <p className="flex items-start gap-2 text-sm">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  {overview.customerAddress}
                </p>
              ) : null}
              {overview?.measuring ? (
                <div className="rounded-md border border-slate-200 bg-slate-50/80 p-3 text-sm">
                  <p className="mb-1 font-medium text-slate-900">Měření</p>
                  <p className="text-slate-800">{overview.measuring}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {effectivePermissions.canViewPhotoFolders ? (
            <>
              <JobMediaSection
                companyId={companyId}
                jobId={jobId}
                jobDisplayName={overview?.name?.trim() ?? null}
                user={user}
                canManageFolders={false}
                photos={legacyPhotos}
                uploadLegacyPhoto={async () => {}}
                legacyUploading={false}
                onAnnotatePhoto={() => {}}
                layout="jobDetailWide"
                mediaScope="employeeLimited"
                memberPermissions={permissionsForMedia}
                employeeRecordId={employeeId}
                showLegacyPhotosForEmployee={showLegacyPhotos}
              />
              {showDocEmpty ? (
                <p className="text-sm text-muted-foreground">
                  Pro tuto zakázku nemáte v aplikaci zpřístupněnou žádnou složku dokumentace — kontaktujte
                  vedoucího zakázky.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Fotodokumentace k této zakázce pro vás není povolena.
            </p>
          )}
        </>
      )}
    </div>
  );
}
