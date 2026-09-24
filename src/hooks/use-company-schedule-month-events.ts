"use client";

import { useEffect, useMemo } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { endOfMonth, startOfMonth } from "date-fns";
import { useFirestore, useMemoFirebase, useCollection } from "@/firebase";
import {
  buildCompanyScheduleEvents,
  type CompanyScheduleCalendarEvent,
} from "@/lib/company-schedule-events";
import { pragueMonthScheduledAtIsoRange } from "@/lib/calendar/company-calendar-service";
import { ORGANIZATION_CALENDAR_EVENTS_COLLECTION } from "@/lib/calendar/organization-calendar-repository";

export function useCompanyScheduleMonthEvents(
  companyId: string | undefined,
  month: Date
): {
  events: CompanyScheduleCalendarEvent[];
  loading: boolean;
} {
  const firestore = useFirestore();
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);

  const meetingsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "lead_meetings"),
      where("scheduledAt", ">=", Timestamp.fromDate(monthStart)),
      where("scheduledAt", "<=", Timestamp.fromDate(monthEnd)),
      orderBy("scheduledAt", "asc")
    );
  }, [firestore, companyId, monthStart.getTime(), monthEnd.getTime()]);

  const measurementsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const { startIso, endIso } = pragueMonthScheduledAtIsoRange(month);
    return query(
      collection(firestore, "companies", companyId, "measurements"),
      where("scheduledAt", ">=", startIso),
      where("scheduledAt", "<=", endIso),
      orderBy("scheduledAt", "asc")
    );
  }, [firestore, companyId, monthStart.getTime(), monthEnd.getTime()]);

  const { data: meetingsRaw = [], isLoading: meetingsLoading } =
    useCollection(meetingsQuery);
  const { data: measurementsRaw = [], isLoading: measurementsLoading } =
    useCollection(measurementsQuery);

  const events = useMemo(
    () => buildCompanyScheduleEvents(meetingsRaw, measurementsRaw),
    [meetingsRaw, measurementsRaw]
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !companyId) return;
    console.log("[CALENDAR] source collection:", ORGANIZATION_CALENDAR_EVENTS_COLLECTION);
    console.log("[CALENDAR] organizationId:", companyId);
    console.log("[CALENDAR] loaded event count:", events.length);
  }, [companyId, events.length]);

  return {
    events,
    loading: meetingsLoading || measurementsLoading,
  };
}
