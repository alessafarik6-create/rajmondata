"use client";

import React, { useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import { JobDetailPageContent } from "@/app/portal/jobs/job-detail-page-content";
import type { JobPhotoAnnotationTarget } from "@/lib/job-media-types";
import type { JobMediaFileNoteTarget } from "@/lib/job-media-file-notes";

function firstStr(v: unknown): string {
  return typeof v === "string" ? v : Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

export default function CustomerJobAnnotatePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const firestore = useFirestore();

  const jobId = firstStr(params?.jobId).trim();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);

  const companyId = typeof (profile as any)?.companyId === "string" ? String((profile as any).companyId) : "";

  const kind = String(searchParams.get("kind") || "").trim();
  const folderId = String(searchParams.get("folderId") || "").trim();
  const mediaId = String(searchParams.get("id") || "").trim();
  const fileType = String(searchParams.get("fileType") || "").trim();
  const canEdit = String(searchParams.get("canEdit") || "").trim() === "1";

  const mediaRef = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId || !mediaId) return null;
    if (kind === "photos") {
      return doc(firestore, "companies", companyId, "jobs", jobId, "photos", mediaId);
    }
    if (kind === "folderImages" && folderId) {
      return doc(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId,
        "folders",
        folderId,
        "images",
        mediaId
      );
    }
    return null;
  }, [firestore, companyId, jobId, kind, folderId, mediaId]);

  const { data: mediaDoc, isLoading: mediaLoading } = useDoc(mediaRef);

  const initialTarget: JobPhotoAnnotationTarget | null = useMemo(() => {
    if (!mediaId || (kind !== "folderImages" && kind !== "photos")) return null;
    if (kind === "folderImages" && !folderId) return null;
    if (!mediaDoc || typeof mediaDoc !== "object") return null;

    const base = mediaDoc as Record<string, unknown>;
    return {
      ...(base as any),
      id: mediaId,
      fileType: fileType === "pdf" ? "pdf" : "image",
      annotationTarget:
        kind === "photos" ? { kind: "photos" } : { kind: "folderImages", folderId },
    } as JobPhotoAnnotationTarget;
  }, [mediaDoc, mediaId, kind, folderId, fileType]);

  const fileNotesTarget: JobMediaFileNoteTarget | null = useMemo(() => {
    if (!mediaId) return null;
    const row = mediaDoc as Record<string, unknown> | undefined;
    const fileName =
      (typeof row?.fileName === "string" && row.fileName.trim()) ||
      (typeof row?.name === "string" && row.name.trim()) ||
      "Soubor";
    return {
      fileId: mediaId,
      folderId: kind === "folderImages" && folderId ? folderId : null,
      fileName,
    };
  }, [mediaDoc, mediaId, kind, folderId]);

  useEffect(() => {
    if (profileLoading) return;
    if (!user) return;
    if ((profile as any)?.role !== "customer") {
      router.replace(`/portal/customer/jobs/${encodeURIComponent(jobId)}`);
    }
  }, [profileLoading, profile, router, jobId, user]);

  if (!user || profileLoading || mediaLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Načítání…</p>
      </div>
    );
  }

  if (!jobId || !companyId || !mediaId) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">
          Nelze otevřít editor anotací (chybí parametry).
        </p>
      </div>
    );
  }

  if (!initialTarget) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">
          Nelze otevřít editor anotací (soubor nebyl nalezen).
        </p>
      </div>
    );
  }

  return (
    <JobDetailPageContent
      customerAnnotationShell
      customerAnnotationShellJobId={jobId}
      customerAnnotationInitialTarget={initialTarget}
      customerAnnotationReturnTo={`/portal/customer/jobs/${encodeURIComponent(jobId)}`}
      customerAnnotationReadOnly={!canEdit}
      mediaAnnotationShellNotesTarget={fileNotesTarget}
      mediaAnnotationShellCustomerPortal
    />
  );
}
