"use client";

import React, { useMemo } from "react";
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
} from "@/lib/job-employee-access";

export default function EmployeeJobDetailPage() {
  const params = useParams();
  const jobId = params?.jobId as string | undefined;
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;

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

  const effectivePermissions =
    memberDoc?.accessMode === "full_internal"
      ? memberPermissions
      : {
          ...DEFAULT_LIMITED_MEMBER_PERMISSIONS,
          ...memberPermissions,
          canViewPhotoFolders: memberPermissions.canViewPhotoFolders !== false,
        };

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

  if (!companyId || !employeeId || !jobId) {
    return (
      <Alert className="max-w-lg">
        <AlertTitle>Chybí údaje</AlertTitle>
        <AlertDescription>
          Nelze načíst zakázku. Zkuste to z portálu zaměstnance.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/employee" className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Přehled
          </Link>
        </Button>
      </div>

      {summaryLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !summary ? (
        <Alert>
          <AlertTitle>Náhled zakázky není k dispozici</AlertTitle>
          <AlertDescription>
            Požádejte administrátora o synchronizaci zakázky (otevření detailu v
            sekci Zakázky), aby se doplnil bezpečný přehled pro zaměstnance.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                {(summary as { name?: string }).name || "Zakázka"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-800">
              {(summary as { description?: string }).description ? (
                <p className="text-slate-700">
                  {(summary as { description: string }).description}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-4 text-xs sm:text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Stav:{" "}
                  <strong>
                    {(summary as { status?: string }).status || "—"}
                  </strong>
                </span>
                {(summary as { startDate?: string }).startDate ? (
                  <span>
                    Zahájení:{" "}
                    <strong>
                      {(summary as { startDate: string }).startDate}
                    </strong>
                  </span>
                ) : null}
                {(summary as { endDate?: string }).endDate ? (
                  <span>
                    Dokončení:{" "}
                    <strong>{(summary as { endDate: string }).endDate}</strong>
                  </span>
                ) : null}
              </div>
              {(summary as { customerAddress?: string }).customerAddress ? (
                <p className="flex items-start gap-2 text-sm">
                  <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                  {(summary as { customerAddress: string }).customerAddress}
                </p>
              ) : null}
              {(summary as { measuring?: string }).measuring ? (
                <div className="rounded-md border border-slate-200 bg-slate-50/80 p-3 text-sm">
                  <p className="font-medium text-slate-900 mb-1">Měření</p>
                  <p className="text-slate-800">
                    {(summary as { measuring: string }).measuring}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {effectivePermissions.canViewPhotoFolders ? (
            <JobMediaSection
              companyId={companyId}
              jobId={jobId}
              jobDisplayName={(summary as { name?: string }).name ?? null}
              user={user}
              canManageFolders={false}
              photos={legacyPhotos}
              uploadLegacyPhoto={async () => {}}
              legacyUploading={false}
              onAnnotatePhoto={() => {}}
              layout="jobDetailWide"
              mediaScope="employeeLimited"
              memberPermissions={effectivePermissions}
              employeeRecordId={employeeId}
              showLegacyPhotosForEmployee={showLegacyPhotos}
            />
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
