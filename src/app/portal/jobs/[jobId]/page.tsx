"use client";

import React, { useEffect, useLayoutEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import {
  MEASUREMENT_PHOTO_ANNOTATE_PAGE_PATH,
  MEASUREMENT_PHOTO_PENDING_EDITOR_ROUTE_JOB_ID,
} from "@/lib/measurement-photo-pending-route";
import { JobDetailPageContent } from "../job-detail-page-content";

/**
 * Běžný zaměstnanec nesmí načítat plný admin detail (rozpočty, doklady, interní kolekce).
 * Přesměrování na bezpečný přehled `/portal/employee/jobs/[jobId]` před mountem obsahu.
 */
export default function JobDetailPage() {
  const { jobId } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const firestore = useFirestore();
  const jobIdForRedirect =
    typeof jobId === "string"
      ? jobId
      : Array.isArray(jobId)
        ? String(jobId[0] ?? "")
        : String(jobId ?? "");
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);

  useLayoutEffect(() => {
    if (jobIdForRedirect !== MEASUREMENT_PHOTO_PENDING_EDITOR_ROUTE_JOB_ID) {
      return;
    }
    const q = searchParams.toString();
    router.replace(
      `${MEASUREMENT_PHOTO_ANNOTATE_PAGE_PATH}${q ? `?${q}` : ""}`,
      { scroll: false }
    );
  }, [jobIdForRedirect, router, searchParams]);

  useEffect(() => {
    if (profileLoading || !jobId) return;
    if (jobIdForRedirect === MEASUREMENT_PHOTO_PENDING_EDITOR_ROUTE_JOB_ID) {
      return;
    }
    if (profile?.role === "employee") {
      router.replace(`/portal/employee/jobs/${jobId}`);
    }
    if (profile?.role === "customer") {
      router.replace(`/portal/customer/jobs/${jobId}`);
    }
  }, [profileLoading, profile?.role, jobId, jobIdForRedirect, router]);

  if (!user || profileLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Načítání…</p>
      </div>
    );
  }

  if (profile?.role === "employee") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Otevírám zakázku…</p>
      </div>
    );
  }

  if (profile?.role === "customer") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Otevírám zakázku…</p>
      </div>
    );
  }

  if (jobIdForRedirect === MEASUREMENT_PHOTO_PENDING_EDITOR_ROUTE_JOB_ID) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Otevírám editor…</p>
      </div>
    );
  }

  return <JobDetailPageContent />;
}