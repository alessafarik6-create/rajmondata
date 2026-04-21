"use client";

import React, { useMemo } from "react";
import { collection, orderBy, query, where } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarClock } from "lucide-react";
import { formatDashboardActivityTime } from "@/components/portal/dashboard-activity-section";
import type { MeetingRecordPublicRow } from "@/lib/meeting-records-types";
import { meetingRecordForCustomerView } from "@/lib/meeting-records-types";

export function CustomerJobMeetingRecordsSection(props: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
}) {
  const { firestore, companyId, jobId } = props;

  const q = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId) return null;
    return query(
      collection(firestore, "companies", companyId, "meetingRecords"),
      where("jobId", "==", jobId),
      where("sharedWithCustomer", "==", true),
      orderBy("meetingAt", "desc")
    );
  }, [firestore, companyId, jobId]);

  const { data: raw, isLoading } = useCollection(q);

  const rows = useMemo(() => {
    const list = Array.isArray(raw) ? (raw as MeetingRecordPublicRow[]) : [];
    return list.filter((r) => r && typeof (r as { id?: string }).id === "string");
  }, [raw]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Záznamy ze schůzek
          </CardTitle>
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
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((r) => {
          const v = meetingRecordForCustomerView({ ...r, id: (r as { id: string }).id });
          return (
            <div
              key={v.id}
              className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-sm space-y-2"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold text-slate-900">{v.title}</p>
                <p className="text-xs text-slate-600">{formatDashboardActivityTime(v.meetingAt)}</p>
              </div>
              {v.place ? (
                <p className="text-xs text-slate-600">
                  <span className="font-medium">Místo:</span> {v.place}
                </p>
              ) : null}
              {v.participants ? (
                <p className="text-xs text-slate-600 whitespace-pre-wrap">
                  <span className="font-medium">Účastníci:</span> {v.participants}
                </p>
              ) : null}
              {v.meetingNotes ? (
                <div>
                  <p className="text-xs font-medium text-slate-700">Poznámky</p>
                  <p className="text-slate-800 whitespace-pre-wrap">{v.meetingNotes}</p>
                </div>
              ) : null}
              {v.nextSteps ? (
                <div>
                  <p className="text-xs font-medium text-slate-700">Další kroky</p>
                  <p className="text-slate-800 whitespace-pre-wrap">{v.nextSteps}</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
