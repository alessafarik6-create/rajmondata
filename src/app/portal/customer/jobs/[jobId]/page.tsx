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
import { canCustomerAccessJob } from "@/lib/job-customer-access";
import { CustomerProductCatalogsSection } from "@/components/customer/customer-product-catalogs-section";
import { CustomerJobProgressCard } from "@/components/customer/customer-job-progress-card";

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

export default function CustomerJobDetailPage() {
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

  const jobRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId && typeof jobId === "string"
        ? doc(firestore, "companies", companyId, "jobs", jobId)
        : null,
    [firestore, companyId, jobId]
  );
  const { data: jobDoc, isLoading: jobLoading } = useDoc(jobRef);

  const photosColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId && typeof jobId === "string"
        ? collection(firestore, "companies", companyId, "jobs", jobId, "photos")
        : null,
    [firestore, companyId, jobId]
  );
  const { data: legacyPhotosData } = useCollection(photosColRef);
  const legacyPhotos = legacyPhotosData ?? undefined;

  const accessAllowed = useMemo(() => {
    if (!user?.uid || !jobId || typeof jobId !== "string" || !jobDoc) return false;
    return canCustomerAccessJob(user.uid, profile as Parameters<typeof canCustomerAccessJob>[1], {
      ...(jobDoc as Record<string, unknown>),
      id: jobId,
    });
  }, [user?.uid, jobId, jobDoc, profile]);

  const overview = useMemo(() => safeJobFields(jobDoc as Record<string, unknown> | undefined), [jobDoc]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!jobId) return;
    console.log("customer linkedJobIds", (profile as { linkedJobIds?: string[] })?.linkedJobIds);
    console.log("loaded customer jobs", jobDoc ? [jobId] : []);
    console.log(
      "customer visible documents",
      "(filtered inside JobMediaSection — customerVisible / internalOnly)"
    );
  }, [jobId, jobDoc, profile]);

  if (!user || profileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if ((profile as { role?: string })?.role !== "customer") {
    return (
      <Alert>
        <AlertTitle>Přístup</AlertTitle>
        <AlertDescription>Nejste přihlášeni jako zákazník.</AlertDescription>
      </Alert>
    );
  }

  if (!companyId || !jobId || typeof jobId !== "string") {
    return (
      <Alert>
        <AlertTitle>Chybí údaje</AlertTitle>
        <AlertDescription>Zakázku nelze načíst.</AlertDescription>
      </Alert>
    );
  }

  if (jobLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!accessAllowed) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-3 py-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/customer/jobs" className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Moje zakázky
          </Link>
        </Button>
        <Alert>
          <AlertTitle>Přístup zamítnut</AlertTitle>
          <AlertDescription>
            Tuto zakázku nemáte v portálu přiřazenou, nebo k ní nemáte oprávnění.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/customer/jobs" className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Moje zakázky
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/customer">Přehled</Link>
        </Button>
      </div>

      <CustomerJobProgressCard
        jobId={jobId}
        jobName={overview?.name?.trim() || "Zakázka"}
        jobData={jobDoc as Record<string, unknown>}
      />

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
        user={user}
        canManageFolders={false}
        photos={legacyPhotos}
        uploadLegacyPhoto={async () => {}}
        legacyUploading={false}
        onAnnotatePhoto={() => {}}
        layout="jobDetailWide"
        mediaScope="customer"
        memberPermissions={null}
        employeeRecordId={null}
        showLegacyPhotosForEmployee={true}
      />

      <CustomerProductCatalogsSection
        companyId={companyId}
        jobId={jobId}
        customerUid={user.uid}
        customerId={(jobDoc as { customerId?: string })?.customerId ?? null}
      />
    </div>
  );
}
