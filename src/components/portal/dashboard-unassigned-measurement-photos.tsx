"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import type { Firestore } from "firebase/firestore";
import {
  collection,
  doc,
  limit,
  query,
  updateDoc,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Camera, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { getJobMediaPreviewUrl, formatMediaDate } from "@/lib/job-media-types";
import { isMeasurementPhotoUnassignedForJob } from "@/lib/measurement-photos";
const PAGE_LIMIT = 60;
const COLLAPSED_COUNT = 5;

type JobNameMap = Record<string, string>;

type Row = Record<string, unknown> & { id: string; createdBy?: string | undefined };

type Props = {
  firestore: Firestore | null;
  companyId: string | null | undefined;
  jobNamesById: JobNameMap;
  userId: string | null | undefined;
};

export function DashboardUnassignedMeasurementPhotos({
  firestore,
  companyId,
  jobNamesById,
  userId,
}: Props) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const qRef = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    /** Bez orderBy — nevyžaduje složený index; řazení řešíme na klientovi. */
    return query(
      collection(firestore, "companies", companyId, "measurement_photos"),
      where("unassigned", "==", true),
      limit(PAGE_LIMIT * 3)
    );
  }, [firestore, companyId]);

  const { data: rawRows, isLoading } = useCollection(qRef);

  const rows = useMemo(() => {
    const list = (rawRows ?? []) as Row[];
    const filtered = list.filter((r) => isMeasurementPhotoUnassignedForJob(r));
    const t = (v: unknown): number => {
      if (v == null) return 0;
      if (typeof v === "number" && !Number.isNaN(v)) return v;
      if (typeof (v as { toMillis?: () => number }).toMillis === "function") {
        return (v as { toMillis: () => number }).toMillis();
      }
      if (typeof (v as { toDate?: () => Date }).toDate === "function") {
        return (v as { toDate: () => Date }).toDate().getTime();
      }
      return 0;
    };
    return [...filtered].sort(
      (a, b) => t(b.createdAt) - t(a.createdAt)
    );
  }, [rawRows]);

  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);
  const hasMore = rows.length > COLLAPSED_COUNT;

  const markAssigned = async (row: Row) => {
    if (!firestore || !companyId || !userId) return;
    setBusyId(row.id);
    try {
      await updateDoc(doc(firestore, "companies", companyId, "measurement_photos", row.id), {
        unassigned: false,
        classificationStatus: "assigned",
        assignedAt: serverTimestamp(),
        assignedBy: userId,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Zařazeno", description: "Foto bylo označeno jako zařazené." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setBusyId(null);
    }
  };

  if (!companyId) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="h-5 w-5 shrink-0" />
          Nezařazené fotky k zakázkám
        </CardTitle>
        <CardDescription>
          Foto zaměření označená jako nezařazená — včetně snímků bez vybrané zakázky (režim „zařadím
          později“). U fotek u zakázky otevřete detail pro úpravy nebo je zde označte jako zařazené.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žádné nezařazené fotky.</p>
        ) : (
          <>
            <ul className="divide-y rounded-md border">
              {visible.map((row) => {
                const jobId =
                  typeof row.jobId === "string" && row.jobId.trim() ? row.jobId.trim() : "";
                const jobName =
                  (jobId && jobNamesById[jobId]) ||
                  (jobId ? `Zakázka ${jobId.slice(0, 8)}…` : "—");
                const preview = getJobMediaPreviewUrl({
                  annotatedImageUrl:
                    typeof row.annotatedImageUrl === "string" ? row.annotatedImageUrl : undefined,
                  imageUrl:
                    typeof row.originalImageUrl === "string" ? row.originalImageUrl : undefined,
                });
                const titleStr =
                  typeof row.title === "string" && row.title.trim()
                    ? row.title.trim()
                    : "Foto zaměření";
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <div className="flex gap-3 min-w-0 flex-1">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted">
                        {preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={preview} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground p-1 text-center">
                            Bez náhledu
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{titleStr}</p>
                        <p className="text-xs text-muted-foreground truncate">{jobName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatMediaDate(row.createdAt)}
                          {typeof row.createdBy === "string" && row.createdBy ? (
                            <span className="ml-1 font-mono opacity-80">
                              · {row.createdBy.slice(0, 8)}…
                            </span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 sm:shrink-0 sm:justify-end">
                      {jobId ? (
                        <Button size="sm" variant="secondary" className="h-8" asChild>
                          <Link href={`/portal/jobs/${jobId}?mp=${row.id}`}>
                            Otevřít / anotovat
                          </Link>
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={busyId === row.id}
                        onClick={() => void markAssigned(row)}
                      >
                        {busyId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Označit zařazené"
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {hasMore ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    Zobrazit méně
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Zobrazit více ({rows.length - COLLAPSED_COUNT} dalších)
                  </>
                )}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
