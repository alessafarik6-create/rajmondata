"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useCompany, useUser } from "@/firebase";
import { usePortalPermissionsOptional } from "@/contexts/portal-permissions-context";
import {
  CompanyScheduleCalendar,
  type ScheduleCalendarPendingAction,
} from "@/components/portal/company-schedule-calendar";

function PortalSchedulePageInner() {
  const { companyId, userProfile } = useCompany();
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const role = String((userProfile as { role?: string } | null)?.role ?? "");
  const isManagement = ["owner", "admin", "manager", "accountant"].includes(role);
  const perm = usePortalPermissionsOptional();
  const calendarWrite = perm?.calendar.anyWrite ?? isManagement;
  const calendarView = perm?.calendar.anyView ?? isManagement;

  const pendingAction = useMemo((): ScheduleCalendarPendingAction | null => {
    const eventId = searchParams.get("event")?.trim();
    if (eventId) {
      return { type: "edit", sourceId: eventId };
    }
    const day = searchParams.get("day")?.trim();
    const create = searchParams.get("create")?.trim();
    if (day && create) {
      const kind = create === "installation" ? "installation" : "lead_meeting";
      return { type: "create", dayKey: day, kind };
    }
    return null;
  }, [searchParams]);

  const clearQuery = useCallback(() => {
    router.replace("/portal/schedule");
  }, [router]);

  if (!companyId || !user) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!calendarView) {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm text-muted-foreground">
        K kalendáři nemáte oprávnění. Kontaktujte administrátora organizace.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="portal-page-title text-2xl">Kalendář</h1>
        <p className="portal-page-description text-sm text-muted-foreground">
          Schůzky, montáže a plánování událostí organizace.
        </p>
      </div>
      <CompanyScheduleCalendar
        companyId={companyId}
        layout="auto"
        readOnly={!isManagement && !calendarWrite}
        restrictEmployeeEvents={role === "employee" && !isManagement}
        pendingAction={pendingAction}
        onPendingActionConsumed={clearQuery}
      />
    </div>
  );
}

export default function PortalSchedulePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PortalSchedulePageInner />
    </Suspense>
  );
}
