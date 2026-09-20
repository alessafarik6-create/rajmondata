"use client";

import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CalendarClock } from "lucide-react";
import {
  formatTrialEndDateCs,
  remainingTrialDays,
} from "@/lib/platform-subscription";

type Props = {
  trialEndsAt?: string | null;
  subscriptionStatus?: string | null;
};

export function PortalTrialStatusBanner({ trialEndsAt, subscriptionStatus }: Props) {
  if (subscriptionStatus !== "TRIAL" || !trialEndsAt) return null;

  const days = remainingTrialDays(trialEndsAt);
  if (days <= 0) return null;

  return (
    <Link href="/portal/vyuctovani" className="block">
      <Alert className="border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-50">
        <CalendarClock className="h-4 w-4 text-sky-700" />
        <AlertTitle className="text-sm font-semibold">Zkušební období</AlertTitle>
        <AlertDescription className="text-sm">
          {days <= 14 ? (
            <>
              Zbývá <strong>{days}</strong> {days === 1 ? "den" : days < 5 ? "dny" : "dní"}. Po skončení přejdete na
              standardní placenou licenci.
            </>
          ) : (
            <>
              Zkušební období končí <strong>{formatTrialEndDateCs(trialEndsAt)}</strong>.
            </>
          )}
        </AlertDescription>
      </Alert>
    </Link>
  );
}
