"use client";

import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CalendarClock } from "lucide-react";
import { formatDashboardActivityTime } from "@/components/portal/dashboard-activity-section";
import type { MeetingRecordPublicRow } from "@/lib/meeting-records-types";
import {
  meetingRecordForCustomerView,
  meetingRecordMeetingAtMs,
  resolveSentToCustomer,
} from "@/lib/meeting-records-types";

const JOB_ID_IN_CHUNK = 30;

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

export function CustomerProfileMeetingRecords(props: {
  firestore: Firestore;
  companyId: string;
  linkedJobIds: string[];
  customerRecordId?: string | null;
}) {
  const { firestore, companyId, linkedJobIds, customerRecordId } = props;

  const jobIds = useMemo(
    () => Array.from(new Set(linkedJobIds.map((id) => String(id).trim()).filter(Boolean))),
    [linkedJobIds]
  );

  const crmId = typeof customerRecordId === "string" ? customerRecordId.trim() : "";

  const [rows, setRows] = useState<(MeetingRecordPublicRow & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !companyId) {
      setRows([]);
      setIsLoading(false);
      return;
    }

    if (jobIds.length === 0 && !crmId) {
      setRows([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const map = new Map<string, MeetingRecordPublicRow & { id: string }>();

        if (jobIds.length > 0) {
          const chunks = chunkIds(jobIds, JOB_ID_IN_CHUNK);
          const snapshots = await Promise.all(
            chunks.map((ids) =>
              getDocs(
                query(
                  collection(firestore, "companies", companyId, "meetingRecords"),
                  where("jobId", "in", ids),
                  limit(120)
                )
              )
            )
          );
          if (cancelled) return;
          for (const snap of snapshots) {
            snap.forEach((docSnap) => {
              const d = docSnap.data() as MeetingRecordPublicRow;
              if (!resolveSentToCustomer(d)) return;
              map.set(docSnap.id, { ...d, id: docSnap.id });
            });
          }
        }

        if (crmId) {
          const crmSnap = await getDocs(
            query(
              collection(firestore, "companies", companyId, "meetingRecords"),
              where("customerId", "==", crmId),
              limit(120)
            )
          );
          if (cancelled) return;
          crmSnap.forEach((docSnap) => {
            const d = docSnap.data() as MeetingRecordPublicRow;
            if (!resolveSentToCustomer(d)) return;
            const jid = typeof d.jobId === "string" ? d.jobId.trim() : "";
            /** Obecné záznamy bez zakázky + sdílené u zakázek zákazníka (deduplikace přes map). */
            map.set(docSnap.id, { ...d, id: docSnap.id });
          });
        }

        const merged = Array.from(map.values()).sort(
          (a, b) => meetingRecordMeetingAtMs(b.meetingAt) - meetingRecordMeetingAtMs(a.meetingAt)
        );
        setRows(merged.slice(0, 35));
      } catch (err) {
        console.error("[CustomerProfileMeetingRecords] Firestore query failed", err);
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, jobIds, crmId]);

  if (jobIds.length === 0 && !crmId) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Záznamy ze schůzek
          </CardTitle>
          <CardDescription>Schůzky, které vám firma zpřístupnila.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Načítání…</p>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />
          Záznamy ze schůzek
        </CardTitle>
        <CardDescription>Schůzky, které vám firma zpřístupnila v portálu.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => {
          const v = meetingRecordForCustomerView(r);
          const jid = v.jobId?.trim();
          return (
            <div
              key={v.id}
              className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-sm space-y-1"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-slate-900">{v.title}</p>
                <p className="text-xs text-slate-600">{formatDashboardActivityTime(v.meetingAt)}</p>
              </div>
              {!jid ? (
                <p className="text-xs text-slate-600">Obecný záznam (bez konkrétní zakázky)</p>
              ) : null}
              {v.meetingNotes ? (
                <p className="text-slate-700 line-clamp-2">{v.meetingNotes}</p>
              ) : null}
              {v.nextSteps ? (
                <p className="text-xs text-slate-600 line-clamp-2">
                  <span className="font-medium text-slate-700">Další kroky: </span>
                  {v.nextSteps}
                </p>
              ) : null}
              {jid ? (
                <Button variant="link" className="h-auto p-0 text-xs" asChild>
                  <Link href={`/portal/customer/jobs/${jid}`}>Otevřít zakázku</Link>
                </Button>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
