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
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ChevronLeft } from "lucide-react";
import { canCustomerAccessJob } from "@/lib/job-customer-access";
import {
  CustomerJobPortalTopBar,
  CustomerJobView,
} from "@/components/customer/customer-job-view";

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
    <CustomerJobView
      companyId={companyId}
      jobId={jobId}
      jobDoc={jobDoc as Record<string, unknown>}
      legacyPhotos={legacyPhotos as Array<Record<string, unknown> & { id: string }> | undefined}
      customerUid={user.uid}
      viewerUser={user}
      readOnly={false}
      topBar={<CustomerJobPortalTopBar jobId={jobId} />}
    />
  );
}
