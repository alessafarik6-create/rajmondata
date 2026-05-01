"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { doc } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { useUser, useFirestore, useMemoFirebase, useDoc } from "@/firebase";
import { JobDetailPageContent } from "../job-detail-page-content";

/**
 * Editor anotací pro nezařazené foto zaměření (dashboard) bez umělého jobId v URL.
 * Sdílí stejný obsah jako detail zakázky — {@link JobDetailPageContent}.
 */
export default function MeasurementAnnotatePage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);

  useEffect(() => {
    if (profileLoading || !user) return;
    if (profile?.role === "employee") {
      router.replace("/portal/dashboard");
    }
    if (profile?.role === "customer") {
      router.replace("/portal/dashboard");
    }
  }, [profileLoading, profile?.role, user, router]);

  if (!user || profileLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Načítání…</p>
      </div>
    );
  }

  if (profile?.role === "employee" || profile?.role === "customer") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Přesměrovávám…</p>
      </div>
    );
  }

  return <JobDetailPageContent measurementAnnotationShell />;
}
