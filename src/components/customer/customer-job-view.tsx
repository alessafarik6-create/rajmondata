"use client";

import React, { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { collection } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, ChevronLeft, MapPin } from "lucide-react";
import { JobMediaSection } from "@/components/jobs/job-media-section";
import { CustomerProductCatalogsSection } from "@/components/customer/customer-product-catalogs-section";
import { CustomerJobProgressCard } from "@/components/customer/customer-job-progress-card";
import { CustomerJobTasksSection } from "@/components/customer/customer-job-tasks-section";
import { CustomerJobQuestionnaireSection } from "@/components/customer/customer-job-questionnaire-section";
import { CustomerJobMediaApprovalsSection } from "@/components/customer/customer-job-media-approvals-section";
import { CustomerJobMeetingRecordsSection } from "@/components/meeting-records/customer-job-meeting-records-section";
import { CustomerJobHandoverProtocolsSection } from "@/components/handover-protocols/customer-job-handover-protocols-section";
import { CustomerChatPanel } from "@/components/customer/customer-chat-panel";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import {
  canCustomerAnnotateImage,
  canCustomerAnnotateLegacyPhoto,
  filterFoldersForCustomer,
} from "@/lib/job-customer-access";
import { buildCustomerJobMediaAnnotateHref } from "@/lib/job-media-annotate-route";
import type { JobPhotoAnnotationTarget } from "@/lib/job-media-types";

function safeJobFields(job: Record<string, unknown> | null | undefined) {
  if (!job) return null;
  return {
    name: typeof job.name === "string" ? job.name : "",
    description: typeof job.description === "string" ? job.description : "",
    status: typeof job.status === "string" ? job.status : "",
    startDate: typeof job.startDate === "string" ? job.startDate : "",
    endDate: typeof job.endDate === "string" ? job.endDate : "",
    customerAddress: typeof job.customerAddress === "string" ? job.customerAddress : "",
  };
}

export type CustomerJobViewProps = {
  companyId: string;
  jobId: string;
  jobDoc: Record<string, unknown> | null | undefined;
  legacyPhotos?: Array<Record<string, unknown> & { id: string }>;
  /** Firebase UID zákazníka v portálu (customerPortalUserIds) — úkoly a výběry. */
  customerUid: string;
  /** Aktuální přihlášený uživatel (zákazník nebo admin při náhledu) — JobMediaSection. */
  viewerUser: User;
  /** Náhled z administrace: žádné zápisy / schvalování. */
  readOnly?: boolean;
  /** Základní URL pro odkazy „Otevřít“ u úkolů (hashy #customer-…). */
  taskLinkBase?: string;
  /** Horní lišta (zákazník: zpět na seznam; admin náhled: pruh + zpět do zakázky). */
  topBar?: React.ReactNode;
};

export function CustomerJobView({
  companyId,
  jobId,
  jobDoc,
  legacyPhotos,
  customerUid,
  viewerUser,
  readOnly = false,
  taskLinkBase,
  topBar,
}: CustomerJobViewProps) {
  const firestore = useFirestore();
  const router = useRouter();
  const overview = useMemo(() => safeJobFields(jobDoc), [jobDoc]);
  const tasksBase = taskLinkBase ?? `/portal/customer/jobs/${jobId}`;

  const foldersColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(firestore, "companies", companyId, "jobs", jobId, "folders")
        : null,
    [firestore, companyId, jobId]
  );
  const { data: foldersRaw } = useCollection(foldersColRef);

  const customerFolders = useMemo(() => {
    const list = (foldersRaw || []).filter(
      (f): f is Record<string, unknown> & { id: string } =>
        !!f && typeof (f as { id?: string }).id === "string"
    );
    return filterFoldersForCustomer(list);
  }, [foldersRaw]);

  const onAnnotatePhoto = useCallback(
    (t: JobPhotoAnnotationTarget) => {
      if (readOnly) return;
      const kind = t.annotationTarget?.kind;
      if (kind !== "folderImages" && kind !== "photos") return;
      const id = String(t.id ?? "").trim();
      if (!id) return;
      const folderId =
        kind === "folderImages" ? String(t.annotationTarget?.folderId ?? "").trim() : "";
      let canEdit = false;
      if (kind === "folderImages") {
        const folder = customerFolders.find((f) => f.id === folderId);
        canEdit = folder
          ? canCustomerAnnotateImage(folder, t as Record<string, unknown>)
          : false;
      } else {
        canEdit = canCustomerAnnotateLegacyPhoto(t as Record<string, unknown>);
      }
      router.push(buildCustomerJobMediaAnnotateHref(jobId, t, canEdit));
    },
    [jobId, router, customerFolders, readOnly]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-4 max-lg:space-y-8 max-lg:px-4 max-lg:pb-8">
      {topBar ? <div className="flex flex-wrap items-center gap-3">{topBar}</div> : null}

      <CustomerJobProgressCard
        jobId={jobId}
        jobName={overview?.name?.trim() || "Zakázka"}
        jobData={jobDoc}
      />

      {firestore && companyId ? (
        <CustomerJobMeetingRecordsSection
          firestore={firestore}
          companyId={companyId}
          jobId={jobId}
        />
      ) : null}

      {firestore && companyId ? (
        <CustomerJobHandoverProtocolsSection
          firestore={firestore}
          companyId={companyId}
          jobId={jobId}
          user={viewerUser}
          readOnly={readOnly}
        />
      ) : null}

      <CustomerJobMediaApprovalsSection
        companyId={companyId}
        jobId={jobId}
        customerUid={customerUid}
        legacyPhotos={
          legacyPhotos as Array<Record<string, unknown> & { id: string }> | undefined
        }
        readOnly={readOnly}
      />

      {!readOnly && companyId ? (
        <CustomerChatPanel companyId={companyId} linkedJobId={jobId} wide />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{overview?.name?.trim() || "Zakázka"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-800">
          {overview?.description ? <p className="text-slate-700">{overview.description}</p> : null}
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
        </CardContent>
      </Card>

      <JobMediaSection
        companyId={companyId}
        jobId={jobId}
        jobDisplayName={overview?.name?.trim() ?? null}
        user={viewerUser}
        canManageFolders={false}
        photos={legacyPhotos}
        uploadLegacyPhoto={async () => {}}
        legacyUploading={false}
        onAnnotatePhoto={onAnnotatePhoto}
        layout="jobDetailWide"
        mediaScope="customer"
        memberPermissions={null}
        employeeRecordId={null}
        showLegacyPhotosForEmployee={true}
      />

      <CustomerJobTasksSection
        companyId={companyId}
        jobId={jobId}
        customerUid={customerUid}
        jobName={overview?.name?.trim() || undefined}
        taskLinkBase={tasksBase}
        readOnly={readOnly}
      />

      <CustomerJobQuestionnaireSection
        companyId={companyId}
        jobId={jobId}
        customerUid={customerUid}
        customerId={(jobDoc as { customerId?: string })?.customerId ?? null}
        jobData={jobDoc}
        readOnly={readOnly}
      />

      <CustomerProductCatalogsSection
        companyId={companyId}
        jobId={jobId}
        customerUid={customerUid}
        customerId={(jobDoc as { customerId?: string })?.customerId ?? null}
        readOnly={readOnly}
      />
    </div>
  );
}

/** Výchozí horní lišta pro zákaznický portál (odkazy Moje zakázky / Přehled). */
export function CustomerJobPortalTopBar({ jobId }: { jobId: string }) {
  return (
    <>
      <Button variant="ghost" size="sm" asChild>
        <Link href="/portal/customer/jobs" className="gap-1">
          <ChevronLeft className="h-4 w-4" />
          Moje zakázky
        </Link>
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <Link href="/portal/customer">Přehled</Link>
      </Button>
    </>
  );
}
